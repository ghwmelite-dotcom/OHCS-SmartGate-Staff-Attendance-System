"""
Generate packages/api/src/db/migration-staff-officers.sql from the OHCS staff list Excel.

Run from repo root:
    python scripts/gen-stafflist-migration.py

Safe to re-run: all INSERTs use INSERT OR IGNORE.
"""
import openpyxl
import re
import warnings
warnings.filterwarnings('ignore')

EXCEL_PATH = 'docs/Staff List/UPDATED STAFFLIST 2026 FOR 39.xlsx'
OUT_PATH = 'packages/api/src/db/migration-staff-officers.sql'

# ---------------------------------------------------------------------------
# Section header → directorate_id mapping
# (None = skip that section entirely)
# ---------------------------------------------------------------------------
SECTION_MAP = {
    'FINANCE AND ADMINISTRATION':                                  'dir_fa',
    'SECRETARIAL UNIT':                                            'dir_cdsec',
    'PROTOCOL UNIT':                                               'dir_protocol',
    'PUBLIC RELATIONS UNIT':                                       'dir_pr',
    'PROCUREMENT AND SUPPLY CHAIN MANAGEMENT UNIT':                'dir_proc',
    'CENTRAL RECORDS UNIT':                                        'dir_rec',
    'ACCOUNTS UNIT':                                               'dir_accounts',
    'INTERNAL AUDIT UNIT':                                         'dir_iau',
    'INTERNAL AUDIT(SERVICE WIDE)':                                'dir_iau_sw',
    'TRANSPORT UNIT':                                              'dir_transport',
    'GENERAL SERVICES UNIT( GSU)':                                 'dir_gsu',
    'ESTATE SUB UNIT':                                             'dir_estate',
    'LABOURERS/CONSERVANCY LABOURERS':                             None,
    'SECURITY UNIT':                                               'dir_security',
    'PLANNING, BUGDETING,MONITORING AND EVALUATION DIRECTORATE':   'dir_pbmed',
    'RESEARCH,STATISTICS AND INFORMATION MANAGEMENT DIRECTORATE':  'dir_rsimd',
    'REFORM COORDINATING UNIT':                                    'dir_rcu',
    'BUREUCRACY LAB/UNIT':                                         'dir_bcl',
    'CIVIL SERVICE COUNCIL SECRETARIAT':                           'dir_csc',
    'CAREER MANAGEMENT DIRECTORATE':                               'dir_cmd',
    'COUNSELLING UNIT':                                            'dir_couns',
    'CENTRAL PERSONNEL REGISTRY':                                  'dir_preg',
    'RECRUITMENT,TRANING AND DEVELOPMENT DIRECTORATE':             'dir_rtdd',
    'STUDY LEAVE WITH PAY':                                        None,
}

# Staff before the first section header belong here
PRE_SECTION_DEFAULTS = {
    '808859': 'dir_hossec',   # Head of Civil Service
    '105587': 'dir_cdsec',    # Chief Director
}

LEAVE_VALUES = {'secondment', 'study leave with pay', 'study leave without pay', 'study leave'}
SEX_VALUES = {'male', 'female'}


def clean_phone(raw):
    """Return first Ghana number from a potentially multi-number string."""
    if not raw or raw.lower() in ('none', ''):
        return None
    first = re.split(r'[/,;]', raw)[0].strip()
    digits = re.sub(r'[^0-9+]', '', first)
    if len(digits) >= 9:
        return first.strip()
    return None


def build_name(col2, col3, col4):
    """Build display name: FirstName [Middle] Surname.

    The sheet stores: col2=Surname, col3=FirstName, col4=MiddleName.
    Middle name column sometimes contains a sex value (data error) — ignore those.
    """
    surname = (col2 or '').strip()
    first   = (col3 or '').strip()
    middle  = (col4 or '').strip()
    if middle.lower() in SEX_VALUES:
        middle = ''
    parts = [p for p in [first, middle, surname] if p]
    return ' '.join(parts) if parts else None


def sql_str(val):
    if val is None:
        return 'NULL'
    escaped = str(val).replace("'", "''")
    return f"'{escaped}'"


def main():
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb.active

    lines = []
    lines.append("-- Staff officer import — generated from UPDATED STAFFLIST 2026 FOR 39.xlsx")
    lines.append("-- DO NOT EDIT by hand. Re-run scripts/gen-stafflist-migration.py to regenerate.")
    lines.append("")

    # New directorates not yet in the seed
    lines.append("-- New org-unit directorates (not in the original seed)")
    lines.append("INSERT OR IGNORE INTO directorates (id, name, abbreviation, type) VALUES")
    new_dirs = [
        ("dir_protocol",  "Protocol Unit",                    "PROTOCOL"),
        ("dir_pr",        "Public Relations Unit",             "PR"),
        ("dir_transport", "Transport Unit",                    "TRANSPORT"),
        ("dir_gsu",       "General Services Unit",             "GSU"),
        ("dir_iau_sw",    "Internal Audit (Service-Wide)",     "IAU-SW"),
        ("dir_bcl",       "Bureaucracy Lab",                   "BCL"),
        ("dir_security",  "Security Unit",                     "SECURITY"),
    ]
    dir_rows = [f"  ({sql_str(d[0])}, {sql_str(d[1])}, {sql_str(d[2])}, 'unit')" for d in new_dirs]
    lines.append(",\n".join(dir_rows) + ";")
    lines.append("")

    # Parse officers
    lines.append("-- Staff officers (name, grade, directorate, phone)")
    lines.append("-- is_available = 0 for staff on secondment or study leave")
    inserts = []

    current_dir_id = None
    skip_section   = False

    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        # Skip sub-header row (row 2)
        if i == 2:
            continue

        col0 = str(row[0]).strip() if row[0] is not None else ''
        col1 = str(row[1]).strip() if row[1] is not None else ''

        # Section header: col0 is text, col1 is blank
        col1_val = row[1]
        if col0 and (col1_val is None or str(col1_val).strip() == '') and not col0.replace('.', '').isdigit():
            dir_id = SECTION_MAP.get(col0)
            if dir_id is None:
                skip_section = True
                current_dir_id = None
            else:
                skip_section = False
                current_dir_id = dir_id
            continue

        # Data row: col0 is a row number
        if not col0 or not col0.replace('.', '').isdigit():
            continue
        if skip_section:
            continue

        staff_no = col1
        if not staff_no or staff_no.lower() == 'none':
            continue

        # Resolve directorate for pre-section staff (HOS, Chief Director)
        dir_id = current_dir_id or PRE_SECTION_DEFAULTS.get(staff_no)
        if not dir_id:
            continue

        col2     = str(row[2]).strip() if row[2] is not None else ''
        col3     = str(row[3]).strip() if row[3] is not None else ''
        col4_raw = row[4]
        col4     = str(col4_raw).strip() if col4_raw is not None else ''
        grade    = str(row[7]).strip() if row[7] is not None else ''
        leave    = str(row[15]).strip().lower() if row[15] is not None else ''
        phone    = clean_phone(str(row[17]).strip() if row[17] is not None else '')

        name = build_name(col2, col3, col4)
        if not name:
            continue

        is_available = 0 if any(v in leave for v in LEAVE_VALUES) else 1
        officer_id   = f'off_{staff_no}'

        inserts.append(
            f"  ({sql_str(officer_id)}, {sql_str(name)}, {sql_str(grade or None)}, "
            f"{sql_str(dir_id)}, {sql_str(phone)}, {is_available})"
        )

    if inserts:
        lines.append("INSERT OR IGNORE INTO officers (id, name, title, directorate_id, phone, is_available) VALUES")
        lines.append(",\n".join(inserts) + ";")

    sql = "\n".join(lines)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write(sql)

    print(f"Written {len(inserts)} officer records to {OUT_PATH}")


if __name__ == '__main__':
    main()
