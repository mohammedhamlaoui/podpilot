import { useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import { uploadExcel } from "../api/client";

const REQUIRED_COLUMNS = [
  "filename",
  "title",
  "description",
  "main_tag",
  "supporting_tags",
  "copy_link"
];

const COLUMN_LABELS = {
  filename: "Filename",
  title: "Title",
  description: "Description",
  main_tag: "Main tag",
  supporting_tags: "Supporting tags",
  copy_link: "Copy link"
};

function normalizeHeader(value) {
  return String(value ?? "").trim();
}

function normalizeCell(value) {
  return String(value ?? "").trim();
}

function getRowValue(row, columnName) {
  return normalizeCell(row[columnName]);
}

function buildDesign(row, index) {
  const filename = getRowValue(row, "filename");

  return {
    id: `${filename || "design"}-${index + 2}`,
    filename,
    title: getRowValue(row, "title"),
    description: getRowValue(row, "description"),
    main_tag: getRowValue(row, "main_tag"),
    supporting_tags: getRowValue(row, "supporting_tags"),
    copy_link: getRowValue(row, "copy_link"),
    sticker_color: "",
    stickers_color_enabled: "Off",
    source_row: index + 2
  };
}

function validateHeaders(headers) {
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));

  if (missingColumns.length > 0) {
    return `Excel is missing these columns: ${missingColumns.join(", ")}.`;
  }

  return "";
}

function parseWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];

        if (!firstSheetName) {
          reject(new Error("The workbook does not contain any sheets."));
          return;
        }

        const sheet = workbook.Sheets[firstSheetName];
        const headerRows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          blankrows: false,
          defval: ""
        });
        const headers = (headerRows[0] || [])
          .map(normalizeHeader)
          .filter((header) => header.length > 0);
        const headerError = validateHeaders(headers);

        if (headerError) {
          reject(new Error(headerError));
          return;
        }

        const rows = XLSX.utils.sheet_to_json(sheet, {
          defval: "",
          raw: false
        });
        const designs = rows
          .map(buildDesign)
          .filter((design) => REQUIRED_COLUMNS.some((column) => design[column]));

        if (designs.length === 0) {
          reject(new Error("The Excel file has the correct columns but no design rows."));
          return;
        }

        resolve(designs);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Could not read the Excel file."));
    };

    reader.readAsArrayBuffer(file);
  });
}

export default function ExcelUpload({ onExcelUploaded }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [designs, setDesigns] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = async (acceptedFiles) => {
    const file = acceptedFiles[0];

    setError("");
    setSuccess("");
    setSelectedFile(null);
    setDesigns([]);

    if (!file) {
      setError("Drop one .xlsx file to continue.");
      return;
    }

    try {
      const parsedDesigns = await parseWorkbook(file);
      setSelectedFile(file);
      setDesigns(parsedDesigns);
    } catch (parseError) {
      setError(parseError.message || "The file could not be parsed.");
    }
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
    },
    maxFiles: 1,
    multiple: false,
    noClick: true,
    noKeyboard: true
  });

  const previewRows = useMemo(() => designs.slice(0, 250), [designs]);

  async function handleConfirmUpload() {
    if (!selectedFile || designs.length === 0) {
      setError("Choose a valid Excel file before uploading.");
      return;
    }

    setIsUploading(true);
    setError("");
    setSuccess("");

    try {
      const response = await uploadExcel(selectedFile);
      const loadedCount =
        response?.count ??
        response?.design_count ??
        response?.designs?.length ??
        designs.length;

      setSuccess(`${loadedCount} designs loaded successfully.`);
      onExcelUploaded(designs, response);
    } catch (uploadError) {
      const detail = uploadError.response?.data?.detail;
      if (!uploadError.response) {
        setError("Backend is not running on localhost:8000. Start FastAPI, then try again.");
      } else if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("The backend rejected the Excel upload.");
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="workflow-panel">
      <div className="panel-heading">
        <div>
          <h2>Upload Excel</h2>
          <p>Drop the sheet that contains the six required Redbubble design columns.</p>
        </div>
        <div className="counter-card">
          <span>{designs.length}</span>
          <small>designs found</small>
        </div>
      </div>

      <div
        {...getRootProps({
          className: `dropzone ${isDragActive ? "dropzone-active" : ""}`
        })}
      >
        <input {...getInputProps()} />
        <div>
          <strong>{selectedFile ? selectedFile.name : "Drop your .xlsx file here"}</strong>
          <span>
            {isDragActive
              ? "Release to parse the spreadsheet"
              : "The dashboard validates the new Redbubble headers before anything is sent to the backend."}
          </span>
        </div>
        <button type="button" className="secondary-button" onClick={open}>
          Browse
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {designs.length > 0 && (
        <>
          <div className="table-toolbar">
            <h3>Preview</h3>
            <button
              type="button"
              className="primary-button"
              onClick={handleConfirmUpload}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "Confirm Excel Upload"}
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {REQUIRED_COLUMNS.map((column) => (
                    <th key={column}>{COLUMN_LABELS[column]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((design) => (
                  <tr key={design.id}>
                    <td>{design.filename}</td>
                    <td>{design.title}</td>
                    <td>{design.description}</td>
                    <td>{design.main_tag}</td>
                    <td>{design.supporting_tags}</td>
                    <td>
                      {design.copy_link ? (
                        <a href={design.copy_link} target="_blank" rel="noreferrer">
                          Open link
                        </a>
                      ) : (
                        <span className="muted-text">No link</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {designs.length > previewRows.length && (
            <p className="muted-text">
              Showing the first {previewRows.length} rows out of {designs.length}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
