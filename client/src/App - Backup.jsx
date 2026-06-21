import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import logo from "./assets/logo.png";
import "./App.css";

const API_URL = "http://localhost:5000/api/reviews";

const ratingOptions = [1, 2, 3, 4, 5];

function App() {
  const [productInput, setProductInput] = useState("");
  const [ratingMode, setRatingMode] = useState("range");
  const [exactRating, setExactRating] = useState(1);
  const [minRating, setMinRating] = useState(1);
  const [maxRating, setMaxRating] = useState(3);

  const [loading, setLoading] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [itemId, setItemId] = useState("");
  const [error, setError] = useState("");
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  const fileBaseName = useMemo(() => {
    return `daraz_reviews_${itemId || "product"}`;
  }, [itemId]);

  const exportRows = useMemo(() => {
    return reviews.map((review) => ({
      rating: review.rating,
      reviewer: review.reviewer || "",
      reviewText: review.reviewText || "",
      reviewDate: review.reviewDate || "",
      skuInfo: review.skuInfo || "",
    }));
  }, [reviews]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setReviews([]);
    setItemId("");
    setShowDownloadModal(false);

    if (!productInput.trim()) {
      setError("Please enter Daraz product ID or product link.");
      return;
    }

    if (ratingMode === "range" && Number(minRating) > Number(maxRating)) {
      setError("Minimum rating cannot be greater than maximum rating.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productInput,
          ratingMode,
          exactRating,
          minRating,
          maxRating,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Something went wrong.");
      }

      setReviews(result.data || []);
      setItemId(result.itemId || "");

      if (result.data?.length) {
        setShowDownloadModal(true);
      } else {
        setError("No reviews found for the selected rating filter.");
      }
    } catch (err) {
      setError(err.message || "Failed to scrape reviews.");
    } finally {
      setLoading(false);
    }
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  };

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(exportRows, null, 2)], {
      type: "application/json",
    });

    downloadBlob(blob, `${fileBaseName}.json`);
  };

  const downloadCSV = () => {
    const headers = ["rating", "reviewer", "reviewText", "reviewDate", "skuInfo"];

    const clean = (value) =>
      String(value ?? "")
        .replace(/\r?\n|\r/g, " ")
        .replace(/"/g, '""');

    const csv = [
      headers.join(","),
      ...exportRows.map((row) =>
        headers.map((h) => `"${clean(row[h])}"`).join(",")
      ),
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    downloadBlob(blob, `${fileBaseName}.csv`);
  };

  const downloadExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Reviews");
    XLSX.writeFile(workbook, `${fileBaseName}.xlsx`);
  };

  const handleDownload = (type) => {
    if (type === "json") downloadJSON();
    if (type === "csv") downloadCSV();
    if (type === "excel") downloadExcel();

    setShowDownloadModal(false);
  };

  return (
    <main className="page">
      <nav className="navbar">
        <div className="brand">
          <div className="brandLogo">
            <img src={logo} alt="Daraz Review Extractor Logo" />
          </div>

          <div>
            <h3>Daraz Review Extractor</h3>
            <span>Review scraping and export tool</span>
          </div>
        </div>

        <div className="navPill">JSON · CSV · Excel</div>
      </nav>

      <section className="hero">
        <div className="heroContent">
          <div className="badge">
            <span>★</span>
            Smart Review Exporter
          </div>

          <h1>Extract Daraz Reviews with Rating Filters</h1>

          <p>
            Paste a Daraz product link or product ID, select your rating filter,
            scrape matching reviews, and download clean data in JSON, CSV, or
            Excel format.
          </p>

          <div className="heroStats">
            <div>
              <strong>01</strong>
              <span>Paste Product</span>
            </div>

            <div>
              <strong>02</strong>
              <span>Filter Ratings</span>
            </div>

            <div>
              <strong>03</strong>
              <span>Export Data</span>
            </div>
          </div>
        </div>

        <div className="heroVisual">
          <img src={logo} alt="Daraz Review Extractor" />
          <div className="floatingTag top">Rating Filter</div>
          <div className="floatingTag bottom">Download Ready</div>
        </div>
      </section>

      <section className="card">
        <form onSubmit={handleSubmit} className="form">
          <div className="sectionTitle">
            <h2>Review Scraper</h2>
            <p>Enter product information and choose the rating filter option.</p>
          </div>

          <div className="field">
            <label>Product ID or Daraz Product Link</label>
            <input
              type="text"
              value={productInput}
              onChange={(e) => setProductInput(e.target.value)}
              placeholder="Example: 118774546 or https://www.daraz.com.bd/products/...-i118774546.html"
            />
          </div>

          <div className="field">
            <label>Rating Filter</label>

            <div className="radioGrid">
              <label className={`radioCard ${ratingMode === "all" ? "active" : ""}`}>
                <input
                  type="radio"
                  value="all"
                  checked={ratingMode === "all"}
                  onChange={(e) => setRatingMode(e.target.value)}
                />
                <span>All Ratings</span>
              </label>

              <label className={`radioCard ${ratingMode === "exact" ? "active" : ""}`}>
                <input
                  type="radio"
                  value="exact"
                  checked={ratingMode === "exact"}
                  onChange={(e) => setRatingMode(e.target.value)}
                />
                <span>Specific Rating</span>
              </label>

              <label className={`radioCard ${ratingMode === "range" ? "active" : ""}`}>
                <input
                  type="radio"
                  value="range"
                  checked={ratingMode === "range"}
                  onChange={(e) => setRatingMode(e.target.value)}
                />
                <span>Rating Range</span>
              </label>
            </div>
          </div>

          {ratingMode === "exact" && (
            <div className="field">
              <label>Select Rating</label>
              <select
                value={exactRating}
                onChange={(e) => setExactRating(e.target.value)}
              >
                {ratingOptions.map((rating) => (
                  <option key={rating} value={rating}>
                    {rating} Star
                  </option>
                ))}
              </select>
            </div>
          )}

          {ratingMode === "range" && (
            <div className="ratingRow">
              <div className="field">
                <label>Minimum Rating</label>
                <select
                  value={minRating}
                  onChange={(e) => setMinRating(e.target.value)}
                >
                  {ratingOptions.map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} Star
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Maximum Rating</label>
                <select
                  value={maxRating}
                  onChange={(e) => setMaxRating(e.target.value)}
                >
                  {ratingOptions.map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} Star
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {error && <div className="errorBox">{error}</div>}

          <button type="submit" className="submitBtn" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                Scraping Reviews...
              </>
            ) : (
              "Scrape Reviews"
            )}
          </button>
        </form>
      </section>

      {reviews.length > 0 && (
        <section className="resultCard">
          <div>
            <p className="resultLabel">Scraping completed</p>
            <h2>{reviews.length} reviews found</h2>
            <p>Product ID: {itemId}</p>
          </div>

          <button
            className="downloadBtn"
            onClick={() => setShowDownloadModal(true)}
          >
            Download Again
          </button>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="tableCard">
          <div className="tableHeader">
            <div>
              <h3>Review Preview</h3>
              <p>Showing first 10 matching reviews</p>
            </div>

            <span>{reviews.length} total</span>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Rating</th>
                  <th>Reviewer</th>
                  <th>Review</th>
                  <th>Date</th>
                  <th>SKU</th>
                </tr>
              </thead>

              <tbody>
                {reviews.slice(0, 10).map((review, index) => (
                  <tr key={index}>
                    <td>
                      <span className="ratingBadge">{review.rating} ★</span>
                    </td>
                    <td>{review.reviewer || "-"}</td>
                    <td>{review.reviewText || "-"}</td>
                    <td>{review.reviewDate || "-"}</td>
                    <td>{review.skuInfo || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showDownloadModal && (
        <div className="modalOverlay">
          <div className="modal">
            <button
              className="closeBtn"
              onClick={() => setShowDownloadModal(false)}
            >
              ×
            </button>

            <div className="modalLogo">
              <img src={logo} alt="Logo" />
            </div>

            <h2>Choose Download Format</h2>

            <p>
              {reviews.length} reviews are ready. Select your preferred export
              format.
            </p>

            <div className="downloadGrid">
              <button onClick={() => handleDownload("json")}>
                <strong>JSON</strong>
                <span>Developer friendly</span>
              </button>

              <button onClick={() => handleDownload("csv")}>
                <strong>CSV</strong>
                <span>Spreadsheet ready</span>
              </button>

              <button onClick={() => handleDownload("excel")}>
                <strong>Excel</strong>
                <span>.xlsx workbook</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;