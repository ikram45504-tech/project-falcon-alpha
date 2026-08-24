import * as XLSX from "xlsx";

export async function downloadExcel(sheets: { name: string; data: any[] }[], filename: string) {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.data);

    if (sheet.data.length > 0) {
      const keys = Object.keys(sheet.data[0]);
      const wscols = keys.map((key) => {
        const maxLen = Math.max(key.length, ...sheet.data.map((row) => (row[key] ? String(row[key]).length : 0)));
        return { wch: Math.min(maxLen + 2, 50) };
      });
      worksheet["!cols"] = wscols;
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const bytes = new Uint8Array(excelBuffer);

  const safeFileName = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (!isTauri) {
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const { downloadDir, join } = await import("@tauri-apps/api/path");
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");

  const defaultPath = await join(await downloadDir(), safeFileName);

  const filePath = await save({
    defaultPath,
    filters: [{ name: "Excel files", extensions: ["xlsx"] }],
  });

  if (filePath) {
    await writeFile(filePath, bytes);
  }
}
