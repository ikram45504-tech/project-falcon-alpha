import * as XLSX from "xlsx";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { downloadDir, join } from "@tauri-apps/api/path";

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
  const defaultPath = await join(await downloadDir(), safeFileName);

  const filePath = await save({
    title: "Save Excel File",
    defaultPath,
    filters: [{ name: "Excel Document", extensions: ["xlsx"] }],
  });

  if (filePath) {
    await writeFile(filePath, bytes);
  }
}
