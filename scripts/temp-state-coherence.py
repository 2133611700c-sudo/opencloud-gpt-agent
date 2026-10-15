import json
from pathlib import Path

path = Path('PROJECT_STATE.json')
state = json.loads(path.read_text(encoding='utf-8'))

# PROJECT_STATE is current truth. Remove superseded narrative mirrors whose
# historical wording already lives in the append-only journal/log.
for field in ('acceptance_notes', 'user_intake'):
    state.pop(field, None)

path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
