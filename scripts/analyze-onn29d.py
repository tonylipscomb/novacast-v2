import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn29d.log"
try:
    text = open(path, "r", encoding="utf-16", errors="replace").read()
except FileNotFoundError:
    text = open(r"C:\Users\tonyl\AppData\Local\Temp\onn29c.log", "r", encoding="utf-16", errors="replace").read()

print("file chars", len(text))
print("category-decode-complete", text.count("category-decode-complete"))
print("mediaType movie", len(re.findall(r"mediaType: 'movie'", text)))
print("mediaType series", len(re.findall(r"mediaType: 'series'", text)))
print("JS get_series", text.count("action: 'get_series'"))
print("JS get_vod_streams", text.count("action: 'get_vod_streams'"))
lags = [int(x) for x in re.findall(r"lagMs: (\d+)", text)]
print("top lags", sorted(lags, reverse=True)[:10])
print("longestObserved max", max([int(x) for x in re.findall(r"longestObservedBlockMs: (\d+)", text)] or [0]))

# native decode stats for series
series_blocks = 0
movie_blocks = 0
max_dl = 0
max_batch = 0
matched_series = 0
matched_movie = 0
batches = 0
for m in re.finditer(
    r"category-decode-complete', \{ mediaType: '(\w+)',[\s\S]{0,400}?matched: (\d+),[\s\S]{0,200}?batches: (\d+),[\s\S]{0,200}?maxBatchSize: (\d+),[\s\S]{0,300}?downloadParseMs: (\d+)",
    text,
):
    mt, matched, b, mb, dl = m.groups()
    batches += int(b)
    max_batch = max(max_batch, int(mb))
    max_dl = max(max_dl, int(dl))
    if mt == "series":
        series_blocks += 1
        matched_series += int(matched)
    else:
        movie_blocks += 1
        matched_movie += int(matched)

print(
    "movieBlocks",
    movie_blocks,
    "matched",
    matched_movie,
    "seriesBlocks",
    series_blocks,
    "matched",
    matched_series,
    "batches",
    batches,
    "maxBatch",
    max_batch,
    "maxNativeDownloadParseMs",
    max_dl,
)

for key in ("movie-sync-completed", "series-sync-completed", "sqlite-sync-completed", "movie-category-native", "series-category-native"):
    print(key, text.count(key))

# PSS note from soak printed separately
print("avg lags", re.findall(r"avgEventLoopLagMs: ([0-9.]+)", text)[-3:])
