"""Read generated workbooks independently of the JavaScript writer."""
import datetime
import json
import sys
import openpyxl

workbook = openpyxl.load_workbook(sys.argv[1], read_only=False, data_only=False)
result = {}
for sheet in workbook:
    result[sheet.title] = {
        "rows": [[cell.value.isoformat(sep=" ") if isinstance(cell.value, datetime.datetime)
                  else cell.value.isoformat() if isinstance(cell.value, datetime.date)
                  else cell.value for cell in row] for row in sheet],
        "types": [[cell.data_type for cell in row] for row in sheet],
        "freeze": sheet.freeze_panes,
    }
print(json.dumps(result, ensure_ascii=True))
