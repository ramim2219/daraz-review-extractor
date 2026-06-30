import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import logo from "./assets/logo.png";
import "./App.css";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(
  /\/$/,
  ""
);

const REVIEW_API_URL = `${API_BASE_URL}/api/reviews`;
const CATEGORY_PRODUCTS_API_URL = `${API_BASE_URL}/api/category-products`;

const ratingOptions = [1, 2, 3, 4, 5];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const [mode, setMode] = useState("single");

  const [productInput, setProductInput] = useState("");
  const [categoryUrl, setCategoryUrl] = useState("");
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(2);

  const [ratingMode, setRatingMode] = useState("range");
  const [exactRating, setExactRating] = useState(1);
  const [minRating, setMinRating] = useState(1);
  const [maxRating, setMaxRating] = useState(3);

  const [loading, setLoading] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [products, setProducts] = useState([]);
  const [itemId, setItemId] = useState("");
  const [error, setError] = useState("");

  const [progress, setProgress] = useState({
    phase: "Idle",
    totalProducts: 0,
    completedProducts: 0,
    failedProducts: 0,
    totalReviews: 0,
    currentProduct: "",
  });

  const fileBaseName = useMemo(() => {
    if (mode === "category") {
      return `daraz_category_reviews_page_${startPage}_to_${endPage}`;
    }

    return `daraz_reviews_${itemId || "product"}`;
  }, [mode, startPage, endPage, itemId]);

  const resetResult = () => {
    setReviews([]);
    setProducts([]);
    setItemId("");
    setError("");
    setProgress({
      phase: "Idle",
      totalProducts: 0,
      completedProducts: 0,
      failedProducts: 0,
      totalReviews: 0,
      currentProduct: "",
    });
  };

  const validateRating = () => {
    if (ratingMode === "range" && Number(minRating) > Number(maxRating)) {
      setError("Minimum rating cannot be greater than maximum rating.");
      return false;
    }

    return true;
  };

  const makeExcelRows = (rows) => {
    if (mode === "category") {
      return rows.map((review) => ({
        productItemId: review.productItemId || "",
        productTitle: review.productTitle || "",
        productUrl: review.productUrl || "",
        categoryPageNo: review.categoryPageNo || "",
        rating: review.rating || "",
        reviewer: review.reviewer || "",
        reviewText: review.reviewText || "",
        reviewDate: review.reviewDate || "",
        skuInfo: review.skuInfo || "",
      }));
    }

    return rows.map((review) => ({
      rating: review.rating || "",
      reviewer: review.reviewer || "",
      reviewText: review.reviewText || "",
      reviewDate: review.reviewDate || "",
      skuInfo: review.skuInfo || "",
    }));
  };

  const downloadExcel = (rows = reviews) => {
    if (!rows.length) {
      setError("No reviews available for Excel download.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(makeExcelRows(rows));
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Reviews");
    XLSX.writeFile(workbook, `${fileBaseName}.xlsx`);
  };

  const handleSingleProductScrape = async (e) => {
    e.preventDefault();

    resetResult();

    if (!productInput.trim()) {
      setError("Please enter Daraz product ID or product link.");
      return;
    }

    if (!validateRating()) return;

    try {
      setLoading(true);

      const response = await fetch(REVIEW_API_URL, {
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

      if (!result.data?.length) {
        setError("No reviews found for the selected rating filter.");
      }
    } catch (err) {
      setError(err.message || "Failed to scrape reviews.");
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryScrape = async (e) => {
    e.preventDefault();

    resetResult();

    if (!categoryUrl.trim()) {
      setError("Please enter Daraz category URL.");
      return;
    }

    if (!categoryUrl.includes("daraz.com.bd")) {
      setError("Please enter a valid Daraz Bangladesh URL.");
      return;
    }

    const start = Number(startPage);
    const end = Number(endPage);

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      setError("Start page and end page must be valid numbers.");
      return;
    }

    if (start < 1 || end < start) {
      setError("Invalid page range.");
      return;
    }

    if (end - start + 1 > 150) {
      setError("Maximum 150 pages can be scanned at once.");
      return;
    }

    if (!validateRating()) return;

    try {
      setLoading(true);

      setProgress({
        phase: "Collecting product IDs",
        totalProducts: 0,
        completedProducts: 0,
        failedProducts: 0,
        totalReviews: 0,
        currentProduct: "",
      });

      const productResponse = await fetch(CATEGORY_PRODUCTS_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categoryUrl,
          startPage: start,
          endPage: end,
        }),
      });

      const productResult = await productResponse.json();

      if (!productResponse.ok || !productResult.success) {
        throw new Error(productResult.message || "Failed to collect products.");
      }

      const collectedProducts = productResult.data || [];

      if (!collectedProducts.length) {
        throw new Error("No products found from this category URL.");
      }

      setProducts(collectedProducts);

      setProgress({
        phase: "Product IDs collected. Now collecting reviews.",
        totalProducts: collectedProducts.length,
        completedProducts: 0,
        failedProducts: 0,
        totalReviews: 0,
        currentProduct: "",
      });

      const allReviews = [];
      let failedProducts = 0;

      for (let index = 0; index < collectedProducts.length; index++) {
        const product = collectedProducts[index];

        setProgress({
          phase: "Collecting product reviews",
          totalProducts: collectedProducts.length,
          completedProducts: index,
          failedProducts,
          totalReviews: allReviews.length,
          currentProduct: product.title || product.itemId,
        });

        try {
          const reviewResponse = await fetch(REVIEW_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              productInput: product.itemId,
              ratingMode,
              exactRating,
              minRating,
              maxRating,
            }),
          });

          const reviewResult = await reviewResponse.json();

          if (!reviewResponse.ok || !reviewResult.success) {
            throw new Error(reviewResult.message || "Failed to scrape product.");
          }

          const productReviews = (reviewResult.data || []).map((review) => ({
            ...review,
            productItemId: product.itemId || "",
            productTitle: product.title || "",
            productUrl: product.productUrl || "",
            categoryPageNo: product.pageNo || "",
          }));

          allReviews.push(...productReviews);

          if (index % 5 === 0) {
            setReviews([...allReviews]);
          }
        } catch {
          failedProducts++;
        }

        await wait(700);
      }

      setReviews(allReviews);

      setProgress({
        phase: "Completed",
        totalProducts: collectedProducts.length,
        completedProducts: collectedProducts.length,
        failedProducts,
        totalReviews: allReviews.length,
        currentProduct: "",
      });

      if (!allReviews.length) {
        setError(
          `Products found: ${collectedProducts.length}, but no matching reviews were found.`
        );
        return;
      }

      downloadExcel(allReviews);
    } catch (err) {
      setError(err.message || "Failed to scrape category reviews.");
    } finally {
      setLoading(false);
    }
  };

  const renderRatingFilter = () => (
    <>
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
    </>
  );

  return (
    <main className="page">
      <nav className="navbar">
        <div className="brand">
          <div className="brandLogo">
            <img src={logo} alt="Daraz Review Extractor Logo" />
          </div>

          <div>
            <h3>Daraz Review Extractor</h3>
            <span>Single product and category review collector</span>
          </div>
        </div>

        <div className="navPill">Single Excel Export</div>
      </nav>

      <section className="hero">
        <div className="heroContent">
          <div className="badge">
            <span>★</span>
            Smart Review Exporter
          </div>

          <h1>Collect Daraz Product Reviews from Product or Category Link</h1>

          <p>
            Paste a single product link or a category link. For category links,
            the system first collects all product IDs, then collects reviews
            from each product and exports everything into one Excel file.
          </p>

          <div className="heroStats">
            <div>
              <strong>01</strong>
              <span>Collect Product IDs</span>
            </div>

            <div>
              <strong>02</strong>
              <span>Collect Reviews</span>
            </div>

            <div>
              <strong>03</strong>
              <span>Download Excel</span>
            </div>
          </div>
        </div>

        <div className="heroVisual">
          <img src={logo} alt="Daraz Review Extractor" />
          <div className="floatingTag top">Category URL</div>
          <div className="floatingTag bottom">Excel Ready</div>
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <h2>Select Scraper Type</h2>
          <p>Choose whether you want to scrape one product or many products.</p>
        </div>

        <div className="radioGrid">
          <label className={`radioCard ${mode === "single" ? "active" : ""}`}>
            <input
              type="radio"
              value="single"
              checked={mode === "single"}
              onChange={(e) => {
                setMode(e.target.value);
                resetResult();
              }}
            />
            <span>Single Product</span>
          </label>

          <label className={`radioCard ${mode === "category" ? "active" : ""}`}>
            <input
              type="radio"
              value="category"
              checked={mode === "category"}
              onChange={(e) => {
                setMode(e.target.value);
                resetResult();
              }}
            />
            <span>Category Link</span>
          </label>
        </div>
      </section>

      <section className="card">
        {mode === "single" ? (
          <form onSubmit={handleSingleProductScrape} className="form">
            <div className="sectionTitle">
              <h2>Single Product Review Scraper</h2>
              <p>Enter product link or product ID.</p>
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

            {renderRatingFilter()}

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
        ) : (
          <form onSubmit={handleCategoryScrape} className="form">
            <div className="sectionTitle">
              <h2>Category Review Scraper</h2>
              <p>
                Paste category link, select page limit, then download all reviews
                in one Excel file.
              </p>
            </div>

            <div className="field">
              <label>Daraz Category Link</label>
              <input
                type="text"
                value={categoryUrl}
                onChange={(e) => setCategoryUrl(e.target.value)}
                placeholder="https://www.daraz.com.bd/catalog/?q=Bags&page=1"
              />
            </div>

            <div className="ratingRow">
              <div className="field">
                <label>Start Page</label>
                <input
                  type="number"
                  min="1"
                  value={startPage}
                  onChange={(e) => setStartPage(e.target.value)}
                />
              </div>

              <div className="field">
                <label>End Page</label>
                <input
                  type="number"
                  min="1"
                  value={endPage}
                  onChange={(e) => setEndPage(e.target.value)}
                />
              </div>
            </div>

            {renderRatingFilter()}

            {error && <div className="errorBox">{error}</div>}

            <button type="submit" className="submitBtn" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Processing Category...
                </>
              ) : (
                "Collect Category Reviews"
              )}
            </button>
          </form>
        )}
      </section>

      {(loading || progress.totalProducts > 0) && mode === "category" && (
        <section className="resultCard">
          <div>
            <p className="resultLabel">{progress.phase}</p>
            <h2>
              {progress.completedProducts} / {progress.totalProducts} products
            </h2>
            <p>Product IDs collected: {products.length}</p>
            <p>Reviews collected: {progress.totalReviews || reviews.length}</p>
            <p>Failed products: {progress.failedProducts}</p>
            {progress.currentProduct && <p>Current: {progress.currentProduct}</p>}
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="resultCard">
          <div>
            <p className="resultLabel">Scraping completed</p>
            <h2>{reviews.length} reviews found</h2>
            <p>
              {mode === "category"
                ? `Products collected: ${products.length}`
                : `Product ID: ${itemId}`}
            </p>
          </div>

          <button className="downloadBtn" onClick={() => downloadExcel()}>
            Download Excel
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
                  {mode === "category" && <th>Product</th>}
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
                    {mode === "category" && (
                      <td>{review.productTitle || review.productItemId}</td>
                    )}
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

      <footer className="footer">
        <p>
          Developed by <strong>Ramim</strong> · All rights reserved © 2026
        </p>
      </footer>
    </main>
  );
}

export default App;