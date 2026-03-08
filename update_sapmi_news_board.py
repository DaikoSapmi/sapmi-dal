#!/usr/bin/env python3
import json
import re
import ssl
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path('/Users/daiko/.openclaw/workspace/sami-news-board')
DATA_PATH = ROOT / 'data' / 'news.json'

SOURCES = [
    ('NRK Sápmi', 'https://www.nrk.no/sapmi/oddasat.rss'),
    ('Yle Sápmi', 'https://feeds.yle.fi/uutiset/v1/recent.rss?publisherIds=YLE_SAPMI'),
    ('SVT Norrbotten', 'https://www.svt.se/nyheter/lokalt/norrbotten/rss.xml'),
    ('Ávvir', 'https://avvir.no/feed/'),
    ('Ságat', 'https://www.sagat.no/atom.xml'),
    ('Vow ASA', 'https://www.vowasa.com/feed/'),
]

IMAGE_FALLBACK_SOURCES = {'Ávvir', 'SVT Norrbotten'}


def fetch_xml(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (SamiNewsBoard/1.0)'})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
        return r.read().decode('utf-8', errors='replace')


def text_of(elem, tag_names):
    for tag in tag_names:
        node = elem.find(tag)
        if node is not None and node.text:
            return node.text.strip()
    return ''


def parse_date(value: str):
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    for fmt in ('%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%d %H:%M:%S'):
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue
    return None


def pick_image(item_elem, summary_text=''):
    # enclosure/media:content/media:thumbnail first
    media_namespaces = [
        '{http://search.yahoo.com/mrss/}content',
        '{http://search.yahoo.com/mrss/}thumbnail',
        'enclosure',
    ]
    for tag in media_namespaces:
        for node in item_elem.findall(tag):
            url = node.attrib.get('url', '').strip()
            if url and ('.jpg' in url or '.jpeg' in url or '.png' in url or '.webp' in url):
                return url

    # image in html content/description
    if summary_text:
        m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', summary_text, flags=re.IGNORECASE)
        if m:
            return m.group(1)

    return ''


def extract_meta_image_from_html(html: str) -> str:
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, flags=re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ''


def fallback_image_from_article(url: str) -> str:
    try:
        html = fetch_xml(url)
        return extract_meta_image_from_html(html)
    except Exception:
        return ''


def parse_feed(source: str, xml_text: str):
    items = []
    root = ET.fromstring(xml_text)
    ns = {
        'atom': 'http://www.w3.org/2005/Atom',
        'dc': 'http://purl.org/dc/elements/1.1/',
        'media': 'http://search.yahoo.com/mrss/',
    }

    # RSS
    channel = root.find('channel')
    if channel is not None:
        for item in channel.findall('item')[:25]:
            title = text_of(item, ['title'])
            link = text_of(item, ['link'])
            pub = text_of(item, ['pubDate', 'dc:date'])
            date = parse_date(pub)
            summary = text_of(item, ['description'])
            image_url = pick_image(item, summary)
            if title and link:
                items.append({
                    'source': source,
                    'title': title,
                    'url': link,
                    'published_at': date.isoformat() if date else '',
                    'summary': summary,
                    'image_url': image_url,
                })
        return items

    # Atom
    for entry in root.findall('atom:entry', ns)[:25] + root.findall('entry')[:25]:
        title = text_of(entry, ['atom:title', 'title'])
        link = ''
        link_node = entry.find('atom:link', ns) or entry.find('link')
        if link_node is not None:
            link = link_node.attrib.get('href', '') or (link_node.text or '').strip()
        updated = text_of(entry, ['atom:updated', 'updated', 'atom:published', 'published'])
        date = parse_date(updated)
        summary = text_of(entry, ['atom:summary', 'summary', 'atom:content', 'content'])
        image_url = pick_image(entry, summary)
        if title and link:
            items.append({
                'source': source,
                'title': title,
                'url': link,
                'published_at': date.isoformat() if date else '',
                'summary': summary,
                'image_url': image_url,
            })
    return items


def main():
    all_items = []
    for source, url in SOURCES:
        try:
            xml_text = fetch_xml(url)
            all_items.extend(parse_feed(source, xml_text))
        except Exception:
            continue

    # dedupe by url
    dedup = {}
    for item in all_items:
        dedup[item['url']] = item

    items = list(dedup.values())
    items.sort(key=lambda x: x.get('published_at', ''), reverse=True)

    # Fallback image scraping for sources where feeds often omit images
    checked = 0
    for item in items:
        if checked >= 30:
            break
        if item.get('image_url'):
            continue
        if item.get('source') not in IMAGE_FALLBACK_SOURCES:
            continue
        img = fallback_image_from_article(item.get('url', ''))
        if img:
            item['image_url'] = img
        checked += 1

    payload = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'count': len(items),
        'items': items[:120],
    }

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Updated {DATA_PATH} with {payload["count"]} articles')


if __name__ == '__main__':
    main()
