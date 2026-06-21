const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 5000;

function extractItemId(input) {
  if (!input) return null;

  const text = String(input).trim();

  if (/^\d+$/.test(text)) return text;

  const match = text.match(/-i(\d+)\.html/i) || text.match(/i(\d+)/i);

  return match ? match[1] : null;
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
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

function normalizeReview(review, itemId) {
  const ratingRaw = pick(review, [
    "rating",
    "ratingScore",
    "star",
    "starRating",
    "score",
  ]);

  const rating = Number(ratingRaw);

  return {
    itemId,
    rating,
    reviewer: pick(review, [
      "buyerName",
      "buyer_name",
      "userName",
      "user_name",
      "customerName",
      "nickName",
      "nickname",
    ]),
    reviewTitle: pick(review, ["title", "reviewTitle", "subject"]),
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
    sellerReply: pick(review, [
      "sellerReply",
      "seller_reply",
      "reply",
      "sellerResponse",
    ]),
    reviewId: pick(review, ["reviewId", "id", "review_id"]),
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
        const row = normalizeReview(review, itemId);

        if (
          ratingMatched(
            row,
            ratingMode,
            exactRating,
            minRating,
            maxRating
          )
        ) {
          allRows.push(row);
        }
      }

      pageNo++;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    return res.json({
      success: true,
      itemId,
      total: allRows.length,
      data: allRows,
    });
  } catch (error) {
    console.error(error.message);

    return res.status(500).json({
      success: false,
      message:
        "Failed to scrape reviews. Daraz API may be blocked or changed.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});