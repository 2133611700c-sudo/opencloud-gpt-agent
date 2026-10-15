from pathlib import Path

workflow_path = Path('.github/workflows/v2-ci.yml')
workflow = workflow_path.read_text(encoding='utf-8')
old_permissions = 'permissions: write-all\n'
new_permissions = 'permissions:\n  contents: read\n  statuses: write\n  id-token: write\n'
if workflow.count(old_permissions) != 1:
    raise SystemExit('expected exactly one permissions: write-all declaration')
workflow = workflow.replace(old_permissions, new_permissions, 1)
workflow_path.write_text(workflow, encoding='utf-8')

validator_path = Path('scripts/validate-foundation.mjs')
validator = validator_path.read_text(encoding='utf-8')
anchor = """if (!workflow.includes('cancel-in-progress: false')) {
  throw new Error('V2 CI must not cancel an in-flight hosted live gate');
}
"""
insert = anchor + """
if (/^permissions:\\s+write-all\\s*$/m.test(workflow)) {
  throw new Error('V2 CI must not grant write-all GitHub token permissions');
}
for (const requiredPermission of [
  'contents: read',
  'statuses: write',
  'id-token: write',
]) {
  if (!workflow.includes(requiredPermission)) {
    throw new Error(`V2 CI is missing least-privilege permission: ${requiredPermission}`);
  }
}
"""
if validator.count(anchor) != 1:
    raise SystemExit('validator insertion anchor did not match exactly once')
validator = validator.replace(anchor, insert, 1)
validator_path.write_text(validator, encoding='utf-8')
