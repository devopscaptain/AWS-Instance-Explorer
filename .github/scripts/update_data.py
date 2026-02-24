import boto3
import json
import os
from collections import defaultdict

def get_pretty_engines(engines_set):
    result = []
    # simplified mapping
    for e in engines_set:
        if 'aurora' in e.lower():
            if 'Aurora' not in result: result.append('Aurora')
        elif 'mysql' in e.lower() or 'mariadb' in e.lower():
            if 'MySQL/MariaDB' not in result: result.append('MySQL/MariaDB')
        elif 'postgres' in e.lower():
            if 'PostgreSQL' not in result: result.append('PostgreSQL')
        elif 'oracle' in e.lower():
            if 'Oracle' not in result: result.append('Oracle')
        elif 'sqlserver' in e.lower():
            if 'SQL Server' not in result: result.append('SQL Server')
        else:
            result.append(e)
    return sorted(list(set(result)))

def get_ec2_prices(pricing_client):
    prices = {}
    print("Fetching EC2 pricing...")
    try:
        paginator = pricing_client.get_paginator('get_products')
        pages = paginator.paginate(
            ServiceCode='AmazonEC2',
            Filters=[
                {'Type': 'TERM_MATCH', 'Field': 'location', 'Value': 'US East (N. Virginia)'},
                {'Type': 'TERM_MATCH', 'Field': 'preInstalledSw', 'Value': 'NA'},
                {'Type': 'TERM_MATCH', 'Field': 'tenancy', 'Value': 'Shared'},
                {'Type': 'TERM_MATCH', 'Field': 'capacitystatus', 'Value': 'Used'}
            ]
        )
        for page in pages:
            for p in page['PriceList']:
                doc = json.loads(p)
                instance_type = doc.get("product", {}).get("attributes", {}).get("instanceType")
                os_type = doc.get("product", {}).get("attributes", {}).get("operatingSystem")
                if not instance_type or os_type not in ['Linux', 'Windows']:
                    continue
                terms = doc.get("terms", {}).get("OnDemand", {})
                for _, term in terms.items():
                    for _, price_dim in term.get("priceDimensions", {}).items():
                        price = price_dim.get("pricePerUnit", {}).get("USD")
                        if price:
                            if instance_type not in prices:
                                prices[instance_type] = {}
                            prices[instance_type][os_type] = float(price)
    except Exception as e:
        print(f"Error fetching EC2 pricing: {e}")
    return prices

def get_rds_prices(pricing_client):
    prices = {}
    print("Fetching RDS pricing (MySQL Single-AZ baseline)...")
    try:
        paginator = pricing_client.get_paginator('get_products')
        pages = paginator.paginate(
            ServiceCode='AmazonRDS',
            Filters=[
                {'Type': 'TERM_MATCH', 'Field': 'location', 'Value': 'US East (N. Virginia)'},
                {'Type': 'TERM_MATCH', 'Field': 'deploymentOption', 'Value': 'Single-AZ'},
                {'Type': 'TERM_MATCH', 'Field': 'databaseEngine', 'Value': 'MySQL'}
            ]
        )
        for page in pages:
            for p in page['PriceList']:
                doc = json.loads(p)
                instance_type = doc.get("product", {}).get("attributes", {}).get("instanceType")
                if not instance_type:
                    continue
                terms = doc.get("terms", {}).get("OnDemand", {})
                for _, term in terms.items():
                    for _, price_dim in term.get("priceDimensions", {}).items():
                        price = price_dim.get("pricePerUnit", {}).get("USD")
                        if price:
                            prices[instance_type] = float(price)
    except Exception as e:
        print(f"Error fetching RDS pricing: {e}")
    return prices

def update_data():
    from datetime import datetime
    
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    data_file = os.path.join(base_dir, 'static', 'data.json')
    
    if not os.path.exists(data_file):
        print(f"Data file not found at {data_file}")
        return

    with open(data_file, 'r') as f:
        data = json.load(f)

    # Note: AWS API requires region, using us-east-1 as baseline for instances
    session = boto3.Session(region_name='us-east-1')
    ec2 = session.client('ec2')
    rds = session.client('rds')
    pricing = session.client('pricing')

    ec2_price_map = get_ec2_prices(pricing)
    rds_price_map = get_rds_prices(pricing)

    print("Fetching EC2 instance types...")
    try:
        paginator = ec2.get_paginator('describe_instance_types')
        ec2_instances_by_family = defaultdict(list)
        
        for page in paginator.paginate():
            for inst in page['InstanceTypes']:
                inst_type = inst['InstanceType']
                family = inst_type.split('.')[0]
                # extract letter part (e.g. t, m, r, c from t3, m5, r6g)
                # some families like 'mac' have multiple letters
                letter = ''.join([c for c in family if c.isalpha()])
                
                vcpu = inst.get('VCpuInfo', {}).get('DefaultVCpus', 0)
                mem_mib = inst.get('MemoryInfo', {}).get('SizeInMiB', 0)
                mem_gib = round(mem_mib / 1024.0, 2)
                if mem_gib.is_integer():
                    mem_gib = int(mem_gib)
                    
                network = inst.get('NetworkInfo', {}).get('NetworkPerformance', 'Moderate')
                current_gen = inst.get('CurrentGeneration', True)
                
                # Check burstable by seeing if 't' is in family prefix
                burstable = 't' in letter

                ec2_instances_by_family[letter].append({
                    "type": inst_type,
                    "vCPUs": vcpu,
                    "memoryGiB": mem_gib,
                    "network": network,
                    "gen": current_gen,
                    "price_hourly": ec2_price_map.get(inst_type, {}).get('Linux'),
                    "price_hourly_windows": ec2_price_map.get(inst_type, {}).get('Windows')
                })

        # Sort and merge
        for family in ec2_instances_by_family:
            ec2_instances_by_family[family].sort(key=lambda x: x['type'])

        # Overwrite instances if they exist in the family structure
        for family in data.get('ec2Families', {}).keys():
            if family in ec2_instances_by_family:
                data['ec2Instances'][family] = ec2_instances_by_family[family]
                
        print("EC2 instance data successfully fetched and merged.")
    except Exception as e:
        print(f"Error fetching EC2 data: {e}. You may need valid AWS credentials.")


    print("Fetching RDS instance classes...")
    try:
        # DB Engine Versions gives us the engines, but let's query instance class options for standard engines
        engines_to_check = ['mysql', 'postgres', 'aurora-mysql', 'aurora-postgresql', 'sqlserver-ee', 'oracle-ee']
        rds_classes = defaultdict(set)
        
        for engine in engines_to_check:
            print(f"  Fetching for engine: {engine}")
            try:
                paginator = rds.get_paginator('describe_orderable_db_instance_options')
                for page in paginator.paginate(Engine=engine):
                    for option in page['OrderableDBInstanceOptions']:
                        db_class = option['DBInstanceClass']
                        rds_classes[db_class].add(engine)
            except Exception as e:
                print(f"  Warning: failed to fetch for {engine}")

        if rds_classes:
            rds_instances_by_family = defaultdict(list)
            for db_class, supported_engines in rds_classes.items():
                if not db_class.startswith('db.'):
                    continue
                parts = db_class.split('.')
                if len(parts) >= 2:
                    family_str = parts[1]
                    letter = ''.join([c for c in family_str if c.isalpha()])
                    
                    pretty_engines = get_pretty_engines(supported_engines)

                    rds_instances_by_family[letter].append({
                        "class": db_class,
                        "engine": ", ".join(pretty_engines),
                        "price_hourly": rds_price_map.get(db_class)
                    })

            for family in rds_instances_by_family:
                rds_instances_by_family[family].sort(key=lambda x: x['class'])

            for family in data.get('rdsFamilies', {}).keys():
                if family in rds_instances_by_family:
                    data['rdsInstances'][family] = rds_instances_by_family[family]
                    
            print("RDS instance data successfully fetched and merged.")
    except Exception as e:
        print(f"Error fetching RDS data: {e}")

    # Add timestamp
    data['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'

    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2)
        
    print("Result safely written to static/data.json")

if __name__ == "__main__":
    update_data()
