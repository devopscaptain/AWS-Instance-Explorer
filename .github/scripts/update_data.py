import boto3
import json
import os
from collections import defaultdict

# Regions for multi-region pricing
PRICING_REGIONS = {
    'us-east-1':      'US East (N. Virginia)',
    'us-west-2':      'US West (Oregon)',
    'eu-west-1':      'EU (Ireland)',
    'ap-southeast-1': 'Asia Pacific (Singapore)',
}

def get_pretty_engines(engines_set):
    seen = set()
    result = []
    for e in engines_set:
        if 'aurora' in e.lower():
            label = 'Aurora'
        elif 'mysql' in e.lower() or 'mariadb' in e.lower():
            label = 'MySQL/MariaDB'
        elif 'postgres' in e.lower():
            label = 'PostgreSQL'
        elif 'oracle' in e.lower():
            label = 'Oracle'
        elif 'sqlserver' in e.lower():
            label = 'SQL Server'
        else:
            label = e
        if label not in seen:
            seen.add(label)
            result.append(label)
    return sorted(result)

def get_ec2_prices(pricing_client, location='US East (N. Virginia)'):
    prices = {}
    print(f"  Fetching EC2 pricing for {location}...")
    try:
        paginator = pricing_client.get_paginator('get_products')
        pages = paginator.paginate(
            ServiceCode='AmazonEC2',
            Filters=[
                {'Type': 'TERM_MATCH', 'Field': 'location',        'Value': location},
                {'Type': 'TERM_MATCH', 'Field': 'preInstalledSw',  'Value': 'NA'},
                {'Type': 'TERM_MATCH', 'Field': 'tenancy',         'Value': 'Shared'},
                {'Type': 'TERM_MATCH', 'Field': 'capacitystatus',  'Value': 'Used'},
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
                        if price and float(price) > 0:
                            if instance_type not in prices:
                                prices[instance_type] = {}
                            prices[instance_type][os_type] = float(price)
    except Exception as e:
        print(f"  Error fetching EC2 pricing for {location}: {e}")
    return prices

def get_rds_prices(pricing_client, location='US East (N. Virginia)'):
    prices = {}
    print(f"  Fetching RDS pricing for {location}...")
    try:
        paginator = pricing_client.get_paginator('get_products')
        pages = paginator.paginate(
            ServiceCode='AmazonRDS',
            Filters=[
                {'Type': 'TERM_MATCH', 'Field': 'location',        'Value': location},
                {'Type': 'TERM_MATCH', 'Field': 'deploymentOption', 'Value': 'Single-AZ'},
                {'Type': 'TERM_MATCH', 'Field': 'databaseEngine',   'Value': 'MySQL'},
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
                        if price and float(price) > 0:
                            prices[instance_type] = float(price)
    except Exception as e:
        print(f"  Error fetching RDS pricing for {location}: {e}")
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

    session = boto3.Session(region_name='us-east-1')
    ec2     = session.client('ec2')
    rds     = session.client('rds')
    pricing = session.client('pricing', region_name='us-east-1')

    # ── Multi-region EC2 + RDS pricing ─────────────────────────
    print("Fetching multi-region pricing...")
    ec2_regional = {}
    rds_regional = {}
    for region_code, location_name in PRICING_REGIONS.items():
        ec2_prices = get_ec2_prices(pricing, location_name)
        for inst_type, os_prices in ec2_prices.items():
            ec2_regional.setdefault(inst_type, {})[region_code] = {
                'linux':   os_prices.get('Linux'),
                'windows': os_prices.get('Windows'),
            }
        rds_prices = get_rds_prices(pricing, location_name)
        for db_class, price in rds_prices.items():
            rds_regional.setdefault(db_class, {})[region_code] = price

    data['ec2RegionalPrices'] = ec2_regional
    data['rdsRegionalPrices'] = rds_regional
    data['supportedRegions']  = list(PRICING_REGIONS.keys())

    # Baseline us-east-1 price map for per-instance fields (backwards compat)
    ec2_price_map = {k: v for k, v in ec2_regional.items()}
    rds_price_map = {k: v.get('us-east-1') for k, v in rds_regional.items()}

    # ── EC2 instance types ──────────────────────────────────────
    print("Fetching EC2 instance types...")
    try:
        paginator = ec2.get_paginator('describe_instance_types')
        ec2_instances_by_family = defaultdict(list)

        for page in paginator.paginate():
            for inst in page['InstanceTypes']:
                inst_type = inst['InstanceType']
                family = inst_type.split('.')[0]
                letter = ''.join([c for c in family if c.isalpha()])

                vcpu    = inst.get('VCpuInfo', {}).get('DefaultVCpus', 0)
                mem_mib = inst.get('MemoryInfo', {}).get('SizeInMiB', 0)
                mem_gib = round(mem_mib / 1024.0, 2)
                if mem_gib.is_integer():
                    mem_gib = int(mem_gib)

                network      = inst.get('NetworkInfo', {}).get('NetworkPerformance', 'Moderate')
                current_gen  = inst.get('CurrentGeneration', True)
                burstable    = 't' in letter

                us_prices    = ec2_price_map.get(inst_type, {})

                ec2_instances_by_family[letter].append({
                    "type":                  inst_type,
                    "vCPUs":                 vcpu,
                    "memoryGiB":             mem_gib,
                    "network":               network,
                    "gen":                   current_gen,
                    "price_hourly":          us_prices.get('us-east-1', {}).get('linux') if isinstance(us_prices.get('us-east-1'), dict) else None,
                    "price_hourly_windows":  us_prices.get('us-east-1', {}).get('windows') if isinstance(us_prices.get('us-east-1'), dict) else None,
                })

        for family in ec2_instances_by_family:
            ec2_instances_by_family[family].sort(key=lambda x: x['type'])

        for family in data.get('ec2Families', {}).keys():
            if family in ec2_instances_by_family:
                data['ec2Instances'][family] = ec2_instances_by_family[family]

        print("EC2 instance data successfully fetched and merged.")
    except Exception as e:
        print(f"Error fetching EC2 data: {e}. You may need valid AWS credentials.")

    # ── RDS instance classes ────────────────────────────────────
    print("Fetching RDS instance classes...")
    try:
        engines_to_check = ['mysql', 'postgres', 'aurora-mysql', 'aurora-postgresql', 'sqlserver-ee', 'oracle-ee']
        rds_classes = defaultdict(set)

        for engine in engines_to_check:
            print(f"  Fetching for engine: {engine}")
            try:
                paginator = rds.get_paginator('describe_orderable_db_instance_options')
                for page in paginator.paginate(Engine=engine):
                    for option in page['OrderableDBInstanceOptions']:
                        rds_classes[option['DBInstanceClass']].add(engine)
            except Exception:
                print(f"  Warning: failed to fetch for {engine}")

        if rds_classes:
            rds_instances_by_family = defaultdict(list)
            for db_class, supported_engines in rds_classes.items():
                if not db_class.startswith('db.'):
                    continue
                parts = db_class.split('.')
                if len(parts) >= 2:
                    letter         = ''.join([c for c in parts[1] if c.isalpha()])
                    pretty_engines = get_pretty_engines(supported_engines)
                    rds_instances_by_family[letter].append({
                        "class":       db_class,
                        "engine":      ", ".join(pretty_engines),
                        "price_hourly": rds_price_map.get(db_class),
                    })

            for family in rds_instances_by_family:
                rds_instances_by_family[family].sort(key=lambda x: x['class'])

            for family in data.get('rdsFamilies', {}).keys():
                if family in rds_instances_by_family:
                    data['rdsInstances'][family] = rds_instances_by_family[family]

            print("RDS instance data successfully fetched and merged.")
    except Exception as e:
        print(f"Error fetching RDS data: {e}")

    data['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'

    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2)

    print("Result safely written to static/data.json")

if __name__ == "__main__":
    update_data()
