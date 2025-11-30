from __future__ import annotations

import json
import re
from collections import deque
from pathlib import Path
from typing import Deque, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urljoin, urldefrag, urlparse

import azure.functions as func
import httpx
from bs4 import BeautifulSoup

from function_app import app

EXCLUDED_SCHEMES: Tuple[str, ...] = ("mailto:", "tel:", "javascript:")
REMOVABLE_TAGS: Tuple[str, ...] = ("script", "style", "nav", "footer", "header", "aside")
DEFAULT_MAX_PAGES: int = 50
OUTPUT_PATH: Path = Path(__file__).resolve().parent / "data" / "website_knowledge.txt"
USER_AGENT = "AIReceptionistCrawler/1.0"


# ---------------------------------------------------------------------------
# Core crawling utilities
# ---------------------------------------------------------------------------

def normalize_url(href: str, base_url: str, root_netloc: str) -> Optional[str]:
    """Resolve links to absolute, same-domain HTTP(S) URLs."""
    href = href.strip()
    if not href or href.startswith(EXCLUDED_SCHEMES) or href.startswith("#"):
        return None

    absolute = urljoin(base_url, href)
    absolute, _ = urldefrag(absolute)
    parsed = urlparse(absolute)

    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.netloc.lower() != root_netloc:
        return None

    return absolute


def clean_text(html: str) -> Tuple[str, str]:
    """Strip noisy tags and normalize whitespace."""
    soup = BeautifulSoup(html, "html.parser")

    for tag in REMOVABLE_TAGS:
        for node in soup.find_all(tag):
            node.decompose()

    title = (soup.title.string or "").strip() if soup.title else ""

    text = soup.get_text(separator="\n")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    cleaned_lines = [line for line in lines if line]
    content = "\n".join(cleaned_lines)

    return title, content


def fetch_page(client: httpx.Client, url: str) -> str:
    """Fetch a single HTML page or raise RuntimeError with details."""
    try:
        response = client.get(url, timeout=10)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Request error for {url}: {exc}") from exc

    if response.status_code >= 400:
        raise RuntimeError(f"HTTP {response.status_code} when fetching {url}")

    content_type = response.headers.get("content-type", "").lower()
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        raise RuntimeError(f"Non-HTML content at {url} ({content_type})")

    return response.text


def crawl_site(start_url: str, max_pages: int = DEFAULT_MAX_PAGES) -> List[Dict[str, str]]:
    """Crawl same-domain pages breadth-first up to max_pages."""
    parsed_start = urlparse(start_url)
    if parsed_start.scheme not in ("http", "https") or not parsed_start.netloc:
        raise ValueError("Start URL must include scheme and host, e.g., https://example.com")

    root_netloc = parsed_start.netloc.lower()
    queue: Deque[str] = deque([start_url])
    visited: Set[str] = set()
    pages: List[Dict[str, str]] = []

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
    }

    with httpx.Client(follow_redirects=True, headers=headers) as client:
        while queue and len(visited) < max_pages:
            current_url = queue.popleft()
            if current_url in visited:
                continue
            visited.add(current_url)

            try:
                html = fetch_page(client, current_url)
            except RuntimeError as exc:
                # Log and skip this URL
                print(f"[warn] {exc}")
                continue

            title, content = clean_text(html)
            pages.append(
                {
                    "url": current_url,
                    "title": title,
                    "content": content,
                }
            )

            soup = BeautifulSoup(html, "html.parser")
            for link in soup.find_all("a", href=True):
                normalized = normalize_url(link["href"], current_url, root_netloc)
                if not normalized or normalized in visited:
                    continue
                if len(visited) + len(queue) >= max_pages:
                    continue
                queue.append(normalized)

    return pages


def write_kb_file(pages: Iterable[Dict[str, str]], output_path: Path = OUTPUT_PATH) -> None:
    """Persist crawled pages to the knowledge base text file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    entries: List[str] = []
    for page in pages:
        entry = (
            f"URL: {page['url']}\n"
            f"TITLE: {page.get('title', '')}\n"
            f"CONTENT:\n{page.get('content', '')}\n"
        )
        entries.append(entry)

    output_path.write_text("\n---\n\n".join(entries))
    print(f"[done] Wrote {len(entries)} pages to {output_path}")


# ---------------------------------------------------------------------------
# Azure Function endpoint
# ---------------------------------------------------------------------------

@app.function_name(name="CrawlerBuildKb")
@app.route(route="crawl-kb", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def crawl_kb_api(req: func.HttpRequest) -> func.HttpResponse:
    """
    POST /api/crawl-kb

    Body (JSON):
    {
      "url": "https://example.com",
      "max_pages": 50,               # optional
      "file_name": "website_kb.txt"  # optional
    }

    Crawls the website starting from 'url', writes a KB text file under ./data,
    and returns a JSON summary.
    """
    try:
        body = req.get_json()
    except ValueError:
        body = {}

    if not isinstance(body, dict):
        body = {}

    url = body.get("url")
    max_pages_raw = body.get("max_pages")
    file_name = body.get("file_name")

    # --- validate url ---
    if not url or not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return func.HttpResponse(
            json.dumps({"error": "Missing or invalid 'url' field"}),
            status_code=400,
            mimetype="application/json",
        )

    # --- validate / normalize max_pages ---
    try:
        max_pages = int(max_pages_raw) if max_pages_raw is not None else DEFAULT_MAX_PAGES
        if max_pages <= 0:
            raise ValueError
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "'max_pages' must be a positive integer"}),
            status_code=400,
            mimetype="application/json",
        )

    # --- determine output path ---
    if file_name and isinstance(file_name, str):
        safe_name = file_name.strip() or "website_knowledge.txt"
    else:
        safe_name = "website_knowledge.txt"

    output_path = OUTPUT_PATH.parent / safe_name

    # --- run crawl + write file ---
    try:
        pages = crawl_site(url, max_pages=max_pages)
    except Exception as exc:  # pragma: no cover - defensive
        return func.HttpResponse(
            json.dumps({"error": f"Failed to crawl site: {exc}"}),
            status_code=500,
            mimetype="application/json",
        )

    try:
        write_kb_file(pages, output_path=output_path)
    except Exception as exc:  # pragma: no cover - defensive
        return func.HttpResponse(
            json.dumps({"error": f"Failed to write knowledge file: {exc}"}),
            status_code=500,
            mimetype="application/json",
        )

    payload = {
        "start_url": url,
        "max_pages": max_pages,
        "pages_crawled": len(pages),
        "output_path": str(output_path),
    }

    return func.HttpResponse(
      json.dumps(payload),
      status_code=200,
      mimetype="application/json",
    )
