"""Label schema shared by the labeler, the draft-labeler, and the eval runner.

Binary signals are labeled true/false/None (None = cannot tell from this image, excluded).
Condition signals use the same vocabulary as the detector so they can be scored as ordinal agreement.
"""
BINARY_SIGNALS = ['provider_truck', 'moving_indicators', 'yard_sign', 'renovation_activity', 'professional_landscaping', 'solar_panels']
CONDITION_SIGNALS = ['lawn_condition', 'exterior_condition', 'roof_condition']
CONDITIONS = ['poor', 'fair', 'good', 'excellent', 'not_visible']
TOP_SIGNAL = 'provider_truck'

def empty_label(door_id: str, image: str) -> dict:
    return {'door_id': door_id, 'image': image, 'image_usable': None,
            **{k: None for k in BINARY_SIGNALS}, **{k: None for k in CONDITION_SIGNALS},
            'labeler': None, 'verified_by_human': False, 'note': ''}
