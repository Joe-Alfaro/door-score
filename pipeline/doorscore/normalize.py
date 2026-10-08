"""Turn raw parcel records into clean Door records.

Entity resolution lives here: one canonical address key per parcel so other sources
(permits, listings, imagery) can be joined despite 'DR' vs 'DRIVE' vs 'DR.' spellings.
Mailing-address fields are consumed to derive owner_occupied and then discarded.
"""
import re
from dataclasses import dataclass, asdict
from shapely.geometry import shape
from .config import AS_OF_YEAR, AS_OF_MONTH

SUFFIX = {
    'AVENUE': 'AVE', 'AVE.': 'AVE', 'AV': 'AVE', 'AV.': 'AVE',
    'STREET': 'ST', 'ST.': 'ST', 'DRIVE': 'DR', 'DR.': 'DR', 'ROAD': 'RD', 'RD.': 'RD',
    'COURT': 'CT', 'CT.': 'CT', 'PLACE': 'PL', 'PL.': 'PL', 'LANE': 'LN', 'LA': 'LN',
    'TERRACE': 'TER', 'TERR': 'TER', 'CIRCLE': 'CIR', 'BOULEVARD': 'BLVD', 'WAY': 'WAY',
}
DIRECTION = {'EAST': 'E', 'WEST': 'W', 'NORTH': 'N', 'SOUTH': 'S', 'E.': 'E', 'W.': 'W', 'N.': 'N', 'S.': 'S'}
SUFFIX_SET = set(SUFFIX.values())

def normalize_address(raw: str | None) -> str:
    """'107 E. Ashgrove Street' / '107 EAST ASHGROVE ST.' -> '107 E ASHGROVE ST'. Returns '' if unparseable."""
    if not raw:
        return ''
    s = re.sub(r'[,#]', ' ', raw.upper())
    s = re.sub(r'\s+', ' ', s).strip()
    toks = s.split(' ')
    out = []
    for i, t in enumerate(toks):
        t = DIRECTION.get(t, t)
        t = SUFFIX.get(t, t)
        if i == len(toks) - 1 and t not in SUFFIX_SET:
            t = t.rstrip('.')
        out.append(t)
    return ' '.join(out)

def normalize_city(raw: str | None) -> str:
    if not raw:
        return ''
    city = re.split(r'[,]', raw.upper())[0].strip()
    return re.sub(r'\s+', ' ', city)

def same_town(a: str, b: str) -> bool:
    """Tolerate one-character typos like RASMEY."""
    if a == b:
        return True
    if len(a) != len(b):
        return False
    return sum(x != y for x, y in zip(a, b)) <= 1 or sorted(a) == sorted(b)

def parse_deed_date(raw: str | None) -> str | None:
    """MOD-IV deed dates are YYMMDD. Pivot two-digit years around the as-of year."""
    if not raw or len(raw) != 6 or not raw.isdigit():
        return None
    yy, mm, dd = int(raw[:2]), int(raw[2:4]), int(raw[4:])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None
    year = 2000 + yy if 2000 + yy <= AS_OF_YEAR else 1900 + yy
    return f'{year:04d}-{mm:02d}-{dd:02d}'

def months_since(iso: str | None) -> int | None:
    if not iso:
        return None
    y, m = int(iso[:4]), int(iso[5:7])
    return (AS_OF_YEAR - y) * 12 + (AS_OF_MONTH - m)

BLDG_RE = re.compile(r'^(?P<mat>[FBSCM]?)(?P<stories>\d)?S?(?P<gar>\d)?(?P<gtype>[GC])?$')
MATERIAL = {'F': 'frame', 'B': 'brick', 'S': 'stone', 'C': 'concrete block', 'M': 'masonry'}

def parse_bldg_desc(raw: str | None) -> dict:
    """'F2S2G' = frame, 2 stories, 2-car garage. Best effort; unknowns are None."""
    res = {'material': None, 'stories': None, 'garage_bays': None}
    if not raw:
        return res
    code = raw.upper().replace('I', '1').split(',')[-1].strip()
    m = BLDG_RE.match(code)
    if not m:
        return res
    res['material'] = MATERIAL.get(m.group('mat'))
    res['stories'] = int(m.group('stories')) if m.group('stories') else None
    if m.group('gtype') == 'G':
        res['garage_bays'] = int(m.group('gar')) if m.group('gar') else 1
    elif m.group('gtype') == 'C':
        res['garage_bays'] = 0  # carport
    return res

def is_single_family(a: dict) -> bool:
    if a.get('PROP_CLASS') not in ('2', '15F'):
        return False
    if (a.get('PCLQCODE') or '').strip().startswith('C'):
        return False
    if (a.get('DWELL') or 1) != 1:
        return False
    if (a.get('CALC_ACRE') or 0) < 0.05:
        return False
    return True

@dataclass
class Door:
    door_id: str
    address: str            # canonical key, e.g. '107 E ASHGROVE ST'
    address_raw: str
    municipality: str
    county: str
    zip5: str | None
    lat: float
    lng: float
    block: str
    lot: str
    prop_class: str
    year_built: int | None
    home_age: int | None
    stories: int | None
    garage_bays: int | None
    material: str | None
    lot_acres: float | None
    land_value: int | None
    improvement_value: int | None
    net_value: int | None
    annual_tax: float | None
    deed_date: str | None
    months_since_deed: int | None
    sale_price: int | None
    arms_length_sale: bool | None
    owner_occupied: bool | None     # derived; mailing address itself is not retained
    owner_mailing_out_of_town: bool | None
    tax_exempt_residence: bool
    parcel_last_updated: int | None

def build_door(feature: dict) -> Door | None:
    a = feature['properties']
    if not is_single_family(a) or not feature.get('geometry'):
        return None
    pt = shape(feature['geometry']).representative_point()
    addr = normalize_address(a.get('PROP_LOC'))
    mail_addr = normalize_address(a.get('ST_ADDRESS'))
    mail_city = normalize_city(a.get('CITY_STATE'))
    town = normalize_city(a.get('MUN_NAME'))
    town = re.sub(r'\s+(BORO|BOROUGH|TWP|TOWNSHIP|CITY|VILLAGE)$', '', town)
    if mail_addr:
        out_of_town = not same_town(mail_city, town) if mail_city else None
        owner_occ = (mail_addr == addr) and not out_of_town
    else:
        out_of_town, owner_occ = None, None
    deed = parse_deed_date(a.get('DEED_DATE'))
    price = a.get('SALE_PRICE')
    bld = parse_bldg_desc(a.get('BLDG_DESC'))
    yr = a.get('YR_CONSTR') or None
    return Door(
        door_id=a['PAMS_PIN'], address=addr, address_raw=a.get('PROP_LOC') or '', municipality=town.title(),
        county=(a.get('COUNTY') or '').title(), zip5=a.get('ZIP5'), lat=round(pt.y, 6), lng=round(pt.x, 6),
        block=a.get('PCLBLOCK') or '', lot=a.get('PCLLOT') or '', prop_class=a.get('PROP_CLASS') or '',
        year_built=yr, home_age=(AS_OF_YEAR - yr) if yr else None,
        stories=bld['stories'], garage_bays=bld['garage_bays'], material=bld['material'],
        lot_acres=a.get('CALC_ACRE'), land_value=a.get('LAND_VAL'), improvement_value=a.get('IMPRVT_VAL'),
        net_value=a.get('NET_VALUE'), annual_tax=a.get('LAST_YR_TX'),
        deed_date=deed, months_since_deed=months_since(deed), sale_price=price,
        arms_length_sale=(price >= 10000) if deed and price is not None else None,
        owner_occupied=owner_occ, owner_mailing_out_of_town=out_of_town,
        tax_exempt_residence=a.get('PROP_CLASS') == '15F',
        parcel_last_updated=a.get('PCLLASTUPD'),
    )

def door_dict(d: Door) -> dict:
    return asdict(d)
