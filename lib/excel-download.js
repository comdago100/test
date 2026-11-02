export function excelSheets(sheets) {
  return sheets.map(sheet => {
    if (sheet.rows.length > 1048575) throw new Error("엑셀의 최대 행 수를 초과했습니다. 대상이나 기간을 줄여 주세요.");
    return {
      sheet: sheet.name, stickyRowsCount: 1, stickyColumnsCount: 1, orientation: "landscape",
      columns: sheet.columns.map(column => ({ width: column.width || 18 })),
      data: [
        sheet.columns.map(column => ({ value: column.title, type: String, fontWeight: "bold",
          backgroundColor: "#24523F", textColor: "#FFFFFF", height: 30, wrap: true })),
        ...sheet.rows.map(row => sheet.columns.map((column, i) => {
          const value = row[i];
          if (value == null) return null;
          if (["date", "datetime"].includes(column.kind))
            return { value, type: Date, format: column.kind === "date" ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm:ss" };
          if (["number", "decimal"].includes(column.kind))
            return { value, type: Number, format: column.kind === "decimal" ? "#,##0.00" : "#,##0" };
          // Always write identifiers, notes and names as text, including strings starting with '='.
          return { value: String(value).slice(0, 32767), type: String, wrap: true };
        })),
      ],
    };
  });
}

export async function workbookBlob(sheets) {
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  return writeExcelFile(excelSheets(sheets), { fontFamily: "맑은 고딕", fontSize: 10 }).toBlob();
}

export async function downloadWorkbook(sheets, filename) {
  const blob = await workbookBlob(sheets);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
