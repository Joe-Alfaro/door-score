"""Unit tests for doorscore.normalize: address keys, dates, building codes, door construction."""
import pytest

from doorscore.config import AS_OF_MONTH, AS_OF_YEAR
from doorscore.normalize import (
    build_door,
    door_dict,
    is_single_family,
    months_since,
    normalize_address,
    parse_bldg_desc,
    parse_deed_date,
    same_town,
)


# ---- normalize_address --------------------------------------------------------------------
@pytest.mark.parametrize(
    ('raw', 'expected'),
    [
        ('67 PENROSE TERR', '67 PENROSE TER'),
        ('244 CALDER AVENUE', '244 CALDER AVE'),
        ('107 E. ASHGROVE STREET', '107 E ASHGROVE ST'),
        ('107 EAST ASHGROVE ST.', '107 E ASHGROVE ST'),
        ('291 WRENFIELD AV', '291 WRENFIELD AVE'),
        ('409 WRENFIELD AVE.', '409 WRENFIELD AVE'),
        ('115 FENNICK DRIVE', '115 FENNICK DR'),
        ('30 THISTLEDOWN LANE', '30 THISTLEDOWN LN'),
        ('161 ORIEL COURT', '161 ORIEL CT'),
        ('60 HALLOWAY PLACE', '60 HALLOWAY PL'),
    ],
)
def test_normalize_address_canonical_forms(raw, expected):
    assert normalize_address(raw) == expected


def test_normalize_address_direction_and_suffix_variants_collide():
    assert normalize_address('366 S MARLOWE AVE') == normalize_address('366 SOUTH MARLOWE AVENUE')


def test_normalize_address_is_case_and_whitespace_insensitive():
    assert normalize_address('  115  fennick   drive ') == '115 FENNICK DR'


def test_normalize_address_none_and_empty():
    assert normalize_address(None) == ''
    assert normalize_address('') == ''


# ---- same_town ----------------------------------------------------------------------------
def test_same_town_tolerates_one_typo_or_transposition():
    assert same_town('RAMSEY', 'RAMSEY') is True
    assert same_town('RASMEY', 'RAMSEY') is True  # transposed letters
    assert same_town('RAMSEI', 'RAMSEY') is True  # single substitution


def test_same_town_rejects_different_towns():
    assert same_town('MAHWAH', 'RAMSEY') is False
    assert same_town('ALLENDALE', 'RAMSEY') is False  # different lengths


# ---- parse_deed_date ----------------------------------------------------------------------
@pytest.mark.parametrize(
    ('raw', 'expected'),
    [
        ('980910', '1998-09-10'),
        ('211025', '2021-10-25'),
        ('040416', '2004-04-16'),
        (None, None),
        ('', None),
        ('9809', None),     # too short
        ('981345', None),   # month 13
        ('98AB10', None),   # non-digit
    ],
)
def test_parse_deed_date(raw, expected):
    assert parse_deed_date(raw) == expected


def test_parse_deed_date_pivots_on_as_of_year():
    yy = AS_OF_YEAR % 100
    assert parse_deed_date(f'{yy:02d}0101') == f'{AS_OF_YEAR}-01-01'
    assert parse_deed_date(f'{yy + 1:02d}0101') == f'{1900 + yy + 1}-01-01'


# ---- months_since -------------------------------------------------------------------------
def test_months_since_known_dates():
    assert months_since(f'{AS_OF_YEAR}-{AS_OF_MONTH:02d}-01') == 0
    assert months_since(f'{AS_OF_YEAR - 1}-{AS_OF_MONTH:02d}-15') == 12
    assert months_since(f'{AS_OF_YEAR - 2}-01-01') == 24 + (AS_OF_MONTH - 1)
    assert months_since('2021-10-25') == (AS_OF_YEAR - 2021) * 12 + (AS_OF_MONTH - 10)


def test_months_since_none():
    assert months_since(None) is None
    assert months_since('') is None


# ---- parse_bldg_desc ----------------------------------------------------------------------
@pytest.mark.parametrize(
    ('raw', 'material', 'stories', 'garage_bays'),
    [
        ('F2S2G', 'frame', 2, 2),
        ('F1S1G', 'frame', 1, 1),
        ('F2S', 'frame', 2, None),
        ('FISIG', 'frame', 1, 1),       # OCR-style I for 1
        ('.9AC,F2S1G', 'frame', 2, 1),  # acreage prefix before the comma
        ('F2S2C', 'frame', 2, 0),       # carport
        ('F2SG', 'frame', 2, 1),        # garage with no bay count defaults to 1
        ('B1S', 'brick', 1, None),
        (None, None, None, None),
        ('', None, None, None),
        ('GARBAGE', None, None, None),
    ],
)
def test_parse_bldg_desc(raw, material, stories, garage_bays):
    assert parse_bldg_desc(raw) == {'material': material, 'stories': stories, 'garage_bays': garage_bays}


# ---- is_single_family ---------------------------------------------------------------------
def _attrs(**overrides):
    base = {'PROP_CLASS': '2', 'CALC_ACRE': 0.3, 'DWELL': 1, 'PCLQCODE': None}
    base.update(overrides)
    return base


def test_is_single_family_happy_path():
    assert is_single_family(_attrs()) is True


def test_is_single_family_condo_qualifier_rejected():
    assert is_single_family(_attrs(PCLQCODE='C0001')) is False


def test_is_single_family_multi_dwelling_rejected():
    assert is_single_family(_attrs(DWELL=2)) is False


def test_is_single_family_tiny_lot_rejected():
    assert is_single_family(_attrs(CALC_ACRE=0.01)) is False


def test_is_single_family_tax_exempt_residence_allowed():
    assert is_single_family(_attrs(PROP_CLASS='15F')) is True


def test_is_single_family_commercial_rejected():
    assert is_single_family(_attrs(PROP_CLASS='4A')) is False


def test_is_single_family_missing_dwell_and_qualifier_default_to_single():
    assert is_single_family(_attrs(DWELL=None, PCLQCODE='')) is True


# ---- build_door ---------------------------------------------------------------------------
def _feature(**overrides):
    props = {
        'PAMS_PIN': '0247_1001_1',
        'PROP_LOC': '115 FENNICK DR',
        'ST_ADDRESS': '106 SOUTH MARLOWE AVE',
        'CITY_STATE': 'RAMSEY, NJ',
        'MUN_NAME': 'RAMSEY BORO',
        'COUNTY': 'BERGEN',
        'ZIP5': '07446',
        'PCLBLOCK': '1001',
        'PCLLOT': '1',
        'PROP_CLASS': '2',
        'CALC_ACRE': 0.3,
        'DWELL': 1,
        'PCLQCODE': None,
        'YR_CONSTR': 1965,
        'BLDG_DESC': 'F2S2G',
        'DEED_DATE': '211025',
        'SALE_PRICE': 650000,
        'LAND_VAL': 300000,
        'IMPRVT_VAL': 350000,
        'NET_VALUE': 650000,
        'LAST_YR_TX': 14500.0,
        'PCLLASTUPD': 20250101,
    }
    props.update(overrides)
    return {
        'type': 'Feature',
        'properties': props,
        'geometry': {
            'type': 'Polygon',
            'coordinates': [[
                [-74.1505, 41.0395],
                [-74.1495, 41.0395],
                [-74.1495, 41.0405],
                [-74.1505, 41.0405],
                [-74.1505, 41.0395],
            ]],
        },
    }


def test_build_door_absentee_in_town():
    door = build_door(_feature())
    assert door is not None
    assert door.owner_occupied is False
    assert door.owner_mailing_out_of_town is False


def test_build_door_absentee_out_of_town():
    door = build_door(_feature(CITY_STATE='VISTA, CA'))
    assert door is not None
    assert door.owner_occupied is False
    assert door.owner_mailing_out_of_town is True


def test_build_door_owner_occupied_despite_spelling_variant():
    door = build_door(_feature(ST_ADDRESS='115 FENNICK DRIVE', CITY_STATE='RAMSEY, NJ'))
    assert door is not None
    assert door.owner_occupied is True
    assert door.owner_mailing_out_of_town is False


def test_build_door_owner_occupied_tolerates_city_typo():
    door = build_door(_feature(ST_ADDRESS='115 FENNICK DRIVE', CITY_STATE='RASMEY NJ 07446'))
    assert door is not None
    assert door.owner_occupied is True


def test_build_door_no_mailing_address_is_unknown():
    door = build_door(_feature(ST_ADDRESS=None, CITY_STATE=None))
    assert door is not None
    assert door.owner_occupied is None
    assert door.owner_mailing_out_of_town is None


def test_build_door_derived_fields():
    door = build_door(_feature())
    assert door is not None
    assert door.door_id == '0247_1001_1'
    assert door.address == '115 FENNICK DR'
    assert door.address_raw == '115 FENNICK DR'
    assert door.municipality == 'Ramsey'
    assert door.county == 'Bergen'
    assert door.deed_date == '2021-10-25'
    assert door.months_since_deed == months_since('2021-10-25')
    assert door.arms_length_sale is True
    assert door.home_age == AS_OF_YEAR - 1965
    assert (door.stories, door.garage_bays, door.material) == (2, 2, 'frame')
    assert door.tax_exempt_residence is False
    # representative point lies inside the polygon drawn around (41.04, -74.15)
    assert 41.0395 <= door.lat <= 41.0405
    assert -74.1505 <= door.lng <= -74.1495


def test_build_door_nominal_sale_is_not_arms_length():
    door = build_door(_feature(SALE_PRICE=1))
    assert door is not None
    assert door.arms_length_sale is False


def test_build_door_rejects_non_single_family_and_missing_geometry():
    assert build_door(_feature(PROP_CLASS='4A')) is None
    feature = _feature()
    feature['geometry'] = None
    assert build_door(feature) is None


def test_build_door_retains_no_pii():
    """Mailing address and owner name must never survive into the Door record."""
    door = build_door(_feature(ST_ADDRESS='106 SOUTH MARLOWE AVE', CITY_STATE='VISTA, CA'))
    assert door is not None
    record = door_dict(door)
    allowed_flags = {'owner_occupied', 'owner_mailing_out_of_town'}
    suspicious = [k for k in record if ('mail' in k.lower() or 'owner_name' in k.lower()) and k not in allowed_flags]
    assert suspicious == []
    assert 'owner_name' not in record
    # The raw mailing values themselves must not appear in any retained string field.
    text_values = ' '.join(str(v) for v in record.values()).upper()
    assert '106 S MARLOWE AVE' not in text_values
    assert 'VISTA' not in text_values
