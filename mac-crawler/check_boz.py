import csv

fpath = '/Users/ad/AmazonAccounting/downloads/2026-10-12/BOZSPACER/05_Campaigns_2026-10-12.csv'
with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
    r = list(csv.DictReader(f))

print('BOZSPACER total rows:', len(r))
non_zero = [x for x in r if x.get('Total cost') not in ('$0.00', '0', '', None)]
print('BOZSPACER rows with cost > 0:', len(non_zero))
states = set(x.get('State') for x in r)
print('BOZSPACER states:', states)
