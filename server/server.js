const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes("*")) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
  })
);

app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractItemId(input) {
  if (!input) return null;

  const text = String(input).trim();

  if (/^\d+$/.test(text)) return text;

  const patterns = [
    /-i(\d+)\.html/i,
    /itemId=(\d+)/i,
    /item_id=(\d+)/i,
    /i(\d+)/i,
    /"itemId"\s*:\s*"?(\d{5,})"?/i,
    /"item_id"\s*:\s*"?(\d{5,})"?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  return "";
}

function extractReviews(json) {
  const paths = [
    json?.model?.items,
    json?.model?.reviews,
    json?.model?.reviewList,
    json?.data?.items,
    json?.data?.reviews,
    json?.data?.reviewList,
    json?.items,
    json?.reviews,
    json?.reviewList,
  ];

  return paths.find(Array.isArray) || [];
}

function normalizeReview(review) {
  const ratingRaw = pick(review, [
    "rating",
    "ratingScore",
    "star",
    "starRating",
    "score",
  ]);

  return {
    rating: Number(ratingRaw),
    reviewer: pick(review, [
      "buyerName",
      "buyer_name",
      "userName",
      "user_name",
      "customerName",
      "nickName",
      "nickname",
    ]),
    reviewText: pick(review, [
      "reviewContent",
      "review_content",
      "content",
      "comment",
      "review",
      "feedback",
    ]),
    reviewDate: pick(review, [
      "reviewTime",
      "review_time",
      "date",
      "createdAt",
      "created_at",
      "gmtCreate",
    ]),
    skuInfo: pick(review, ["skuInfo", "sku", "variation", "skuText"]),
  };
}

function ratingMatched(row, mode, exactRating, minRating, maxRating) {
  if (!Number.isFinite(row.rating)) return false;

  if (mode === "all") return true;

  if (mode === "exact") {
    return row.rating === Number(exactRating);
  }

  if (mode === "range") {
    return row.rating >= Number(minRating) && row.rating <= Number(maxRating);
  }

  return true;
}

function cleanProductUrl(url = "") {
  if (!url) return "";

  let cleanUrl = String(url)
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();

  if (cleanUrl.startsWith("//")) {
    cleanUrl = `https:${cleanUrl}`;
  }

  if (cleanUrl.startsWith("/products/")) {
    cleanUrl = `https://www.daraz.com.bd${cleanUrl}`;
  }

  return cleanUrl.split("?")[0].split("#")[0];
}

function slugifyDarazQuery(query = "") {
  return String(query)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function buildCategoryCandidateUrls(categoryUrl, pageNo) {
  const candidates = [];

  const addUrl = (url) => {
    const text = url.toString();

    if (!candidates.includes(text)) {
      candidates.push(text);
    }
  };

  const originalUrl = new URL(categoryUrl);
  const query = originalUrl.searchParams.get("q") || "";

  // Method 1: Original category URL + ajax=true
  const originalAjaxUrl = new URL(categoryUrl);
  originalAjaxUrl.searchParams.set("ajax", "true");
  originalAjaxUrl.searchParams.set("page", String(pageNo));
  addUrl(originalAjaxUrl);

  // Method 2: Clean catalog URL
  if (query) {
    const cleanCatalogUrl = new URL("https://www.daraz.com.bd/catalog/");
    cleanCatalogUrl.searchParams.set("ajax", "true");
    cleanCatalogUrl.searchParams.set("q", query);
    cleanCatalogUrl.searchParams.set("page", String(pageNo));
    cleanCatalogUrl.searchParams.set("from", "input");
    cleanCatalogUrl.searchParams.set("src", "all_channel");
    cleanCatalogUrl.searchParams.set("service", "all_channel");
    addUrl(cleanCatalogUrl);
  }

  // Method 3: Tag URL
  if (query) {
    const slug = slugifyDarazQuery(query);

    if (slug) {
      const tagUrl = new URL(`https://www.daraz.com.bd/tag/${slug}/`);
      tagUrl.searchParams.set("ajax", "true");
      tagUrl.searchParams.set("page", String(pageNo));
      addUrl(tagUrl);
    }
  }

  return candidates;
}

function getListItems(data) {
  if (Array.isArray(data?.mods?.listItems)) return data.mods.listItems;
  if (Array.isArray(data?.mods?.list_items)) return data.mods.list_items;
  if (Array.isArray(data?.listItems)) return data.listItems;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.items)) return data.data.items;
  if (Array.isArray(data?.data?.listItems)) return data.data.listItems;

  return [];
}

function extractProductsFromAjaxData(data, pageNo) {
  const products = [];
  const listItems = getListItems(data);

  if (!Array.isArray(listItems)) return products;

  for (const item of listItems) {
    const productUrl = cleanProductUrl(
      item.productUrl ||
        item.itemUrl ||
        item.url ||
        item.product_url ||
        item.item_url ||
        item.clickUrl ||
        ""
    );

    const itemId =
      String(
        item.itemId ||
          item.item_id ||
          item.productId ||
          item.product_id ||
          item.nid ||
          ""
      ) || extractItemId(productUrl);

    if (!itemId) continue;

    products.push({
      itemId,
      title:
        item.name ||
        item.title ||
        item.productName ||
        item.product_name ||
        "",
      productUrl,
      pageNo,
    });
  }

  return products;
}

function fallbackExtractProducts(rawText, pageNo) {
  const products = [];
  const found = new Map();

  const text = String(rawText || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/");

  const urlRegex =
    /((?:https?:)?\/\/www\.daraz\.com\.bd\/products\/[^"'<>\\\s]+?-i\d+\.html[^"'<>\\\s]*)|(\/products\/[^"'<>\\\s]+?-i\d+\.html[^"'<>\\\s]*)/gi;

  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const productUrl = cleanProductUrl(match[1] || match[2]);
    const itemId = extractItemId(productUrl);

    if (!itemId || found.has(itemId)) continue;

    found.set(itemId, true);

    products.push({
      itemId,
      title: "",
      productUrl,
      pageNo,
    });
  }

  const itemIdRegex = /"itemId"\s*:\s*"?(\d{5,})"?/gi;

  while ((match = itemIdRegex.exec(text)) !== null) {
    const itemId = match[1];

    if (!itemId || found.has(itemId)) continue;

    found.set(itemId, true);

    products.push({
      itemId,
      title: "",
      productUrl: "",
      pageNo,
    });
  }

  return products;
}

async function fetchProductsFromCategoryPage(categoryUrl, pageNo) {
  const candidateUrls = buildCategoryCandidateUrls(categoryUrl, pageNo);

  for (const ajaxUrl of candidateUrls) {
    try {
      console.log(`Trying category page ${pageNo}: ${ajaxUrl}`);

      const response = await axios.get(ajaxUrl, {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-US,en;q=0.9,bn;q=0.8",
          "x-requested-with": "XMLHttpRequest",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          referer: "https://www.daraz.com.bd/",
        },
        timeout: 20000,
      });

      let data = response.data;

      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          const fallbackProducts = fallbackExtractProducts(data, pageNo);

          if (fallbackProducts.length) {
            console.log(
              `Page ${pageNo}: found ${fallbackProducts.length} products by fallback text`
            );
            return fallbackProducts;
          }

          continue;
        }
      }

      const products = extractProductsFromAjaxData(data, pageNo);

      if (products.length) {
        console.log(`Page ${pageNo}: found ${products.length} products`);
        return products;
      }

      const fallbackProducts = fallbackExtractProducts(
        JSON.stringify(data),
        pageNo
      );

      if (fallbackProducts.length) {
        console.log(
          `Page ${pageNo}: found ${fallbackProducts.length} products by fallback JSON`
        );
        return fallbackProducts;
      }
    } catch (error) {
      console.log(`Page ${pageNo} method failed: ${error.message}`);
    }
  }

  console.log(`Page ${pageNo}: no products found`);
  return [];
}

async function scrapeReviewsByItemId({
  itemId,
  ratingMode = "all",
  exactRating = 1,
  minRating = 1,
  maxRating = 3,
}) {
  const pageSize = 50;
  const maxPagesSafety = 200;
  const allRows = [];

  let pageNo = 1;

  while (pageNo <= maxPagesSafety) {
    const url =
      `https://my.daraz.com.bd/pdp/review/getReviewList` +
      `?itemId=${itemId}&pageSize=${pageSize}&filter=0&sort=0&pageNo=${pageNo}`;

    const response = await axios.get(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "x-requested-with": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        referer: "https://www.daraz.com.bd/",
      },
      timeout: 15000,
    });

    const reviews = extractReviews(response.data);

    if (!reviews.length) break;

    for (const review of reviews) {
      const row = normalizeReview(review);

      if (ratingMatched(row, ratingMode, exactRating, minRating, maxRating)) {
        allRows.push(row);
      }
    }

    pageNo++;

    await sleep(350);
  }

  return allRows;
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Daraz Review Extractor API is running",
  });
});

app.post("/api/reviews", async (req, res) => {
  try {
    const {
      productInput,
      ratingMode = "all",
      exactRating = 1,
      minRating = 1,
      maxRating = 3,
    } = req.body;

    const itemId = extractItemId(productInput);

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "Invalid Daraz product ID or link.",
      });
    }

    const allRows = await scrapeReviewsByItemId({
      itemId,
      ratingMode,
      exactRating,
      minRating,
      maxRating,
    });

    return res.json({
      success: true,
      itemId,
      total: allRows.length,
      data: allRows,
    });
  } catch (error) {
    console.error("Review scraping error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to scrape reviews.",
    });
  }
});

app.post("/api/category-products", async (req, res) => {
  try {
    const { categoryUrl, startPage = 1, endPage = 1 } = req.body;

    if (!categoryUrl || !String(categoryUrl).includes("daraz.com.bd")) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid Daraz category URL.",
      });
    }

    const start = Number(startPage);
    const end = Number(endPage);

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return res.status(400).json({
        success: false,
        message: "Page numbers must be valid numbers.",
      });
    }

    if (start < 1 || end < start) {
      return res.status(400).json({
        success: false,
        message: "Invalid page range.",
      });
    }

    if (end - start + 1 > 150) {
      return res.status(400).json({
        success: false,
        message: "Maximum 150 pages allowed at once.",
      });
    }

    const productMap = new Map();
    const failedPages = [];

    for (let pageNo = start; pageNo <= end; pageNo++) {
      try {
        const products = await fetchProductsFromCategoryPage(
          categoryUrl,
          pageNo
        );

        console.log(`Final page ${pageNo}: ${products.length} products`);

        for (const product of products) {
          if (!productMap.has(product.itemId)) {
            productMap.set(product.itemId, product);
          }
        }
      } catch (error) {
        failedPages.push(pageNo);
        console.log(`Page ${pageNo} failed: ${error.message}`);
      }

      await sleep(700);
    }

    const products = Array.from(productMap.values());

    return res.json({
      success: true,
      total: products.length,
      failedPages,
      data: products,
    });
  } catch (error) {
    console.error("Category product collection error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to collect products from category.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});