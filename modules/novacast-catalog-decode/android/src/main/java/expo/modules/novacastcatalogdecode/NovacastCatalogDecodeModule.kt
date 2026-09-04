package expo.modules.novacastcatalogdecode

import android.util.JsonReader
import android.util.JsonToken
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStreamReader
import java.io.Reader
import java.util.ArrayDeque
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Stage 2.9 — off-JS Xtream JSON-array decode with pull-based backpressure.
 * Downloads and streams JSON on Dispatchers.IO; JS pulls bounded batches only.
 * Never logs credentials, full URLs, or response bodies.
 */
class NovacastCatalogDecodeModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val jobs = ConcurrentHashMap<String, DecodeJob>()
  private var cancellationCount = 0
  private var completedCleanupCount = 0

  override fun definition() = ModuleDefinition {
    Name("NovacastCatalogDecode")

    Constants(
      "isAvailable" to true,
      "marker" to "stage295-native-completion-v1",
    )

    AsyncFunction("isNativeDecodeAvailable") {
      true
    }

    AsyncFunction("getJobRegistrySnapshot") {
      val now = System.currentTimeMillis()
      val active = jobs.values.map { job ->
        mapOf(
          "jobId" to job.jobId,
          "mediaType" to job.mediaTypePublic,
          "providerId" to job.providerIdPublic,
          "ageMs" to (now - job.startedAtMs),
          "batchesEmitted" to job.batchesEmittedPublic,
        )
      }
      val oldestAge = active.maxOfOrNull { (it["ageMs"] as Long) } ?: 0L
      mapOf(
        "activeJobCount" to jobs.size,
        "queuedBatchCount" to jobs.values.sumOf { it.queuedBatchEstimate() },
        "oldestJobAgeMs" to oldestAge,
        "cancellationCount" to cancellationCount,
        "completedJobCleanupCount" to completedCleanupCount,
        "jobs" to active,
      )
    }

    AsyncFunction("startDecodeJob") { options: Map<String, Any?>, promise: Promise ->
      try {
        val requestUrl = options["requestUrl"] as? String
          ?: throw IllegalArgumentException("requestUrl required")
        val mediaType = options["mediaType"] as? String
          ?: throw IllegalArgumentException("mediaType required")
        if (mediaType != "movie" && mediaType != "series") {
          throw IllegalArgumentException("mediaType must be movie|series")
        }
        val filterCategoryId = options["filterCategoryId"] as? String
        val batchSize = ((options["batchSize"] as? Number)?.toInt() ?: 100).coerceIn(25, 200)
        val timeoutMs = ((options["timeoutMs"] as? Number)?.toLong() ?: 60_000L).coerceIn(5_000L, 180_000L)
        val providerId = options["providerId"] as? String ?: ""
        val expectedProviderId = options["expectedProviderId"] as? String ?: providerId
        val generation = (options["generation"] as? Number)?.toInt()
        val categoryIndex = (options["categoryIndex"] as? Number)?.toInt()
        val categoryPosition = (options["categoryPosition"] as? Number)?.toInt()
        val totalCategoryCount = (options["totalCategoryCount"] as? Number)?.toInt()
        val requestAttempt = ((options["requestAttempt"] as? Number)?.toInt() ?: 1)
        val preserveLiveEpgChannelId = options["preserveLiveEpgChannelId"] as? Boolean ?: false

        val jobId = UUID.randomUUID().toString()
        val job = DecodeJob(
          jobId = jobId,
          requestUrl = requestUrl,
          mediaType = mediaType,
          filterCategoryId = filterCategoryId,
          batchSize = batchSize,
          timeoutMs = timeoutMs,
          providerId = providerId,
          expectedProviderId = expectedProviderId,
          generation = generation,
          categoryIndex = categoryIndex,
          categoryPosition = categoryPosition,
          totalCategoryCount = totalCategoryCount,
          requestAttempt = requestAttempt,
          preserveLiveEpgChannelId = preserveLiveEpgChannelId,
        )
        jobs[jobId] = job
        job.start(scope) {
          jobs.remove(jobId)
          completedCleanupCount += 1
        }
        promise.resolve(
          mapOf(
            "jobId" to jobId,
            "batchSize" to batchSize,
            "marker" to "stage295-native-completion-v1",
          ),
        )
      } catch (error: Throwable) {
        promise.reject("E_START", error.message ?: "start failed", error)
      }
    }

    AsyncFunction("pullDecodeBatch") { jobId: String, promise: Promise ->
      val job = jobs[jobId]
      if (job == null) {
        promise.resolve(
          mapOf(
            "jobId" to jobId,
            "items" to emptyList<Map<String, Any?>>(),
            "done" to true,
            "cancelled" to true,
            "error" to "job_missing",
          ),
        )
        return@AsyncFunction
      }
      scope.launch {
        try {
          val batch = job.pull()
          promise.resolve(batch.toMap())
          if (batch.done) {
            jobs.remove(jobId)
          }
        } catch (error: CancellationException) {
          jobs.remove(jobId)
          promise.resolve(
            mapOf(
              "jobId" to jobId,
              "items" to emptyList<Map<String, Any?>>(),
              "done" to true,
              "cancelled" to true,
            ),
          )
        } catch (error: Throwable) {
          jobs.remove(jobId)
          promise.reject("E_PULL", error.message ?: "pull failed", error)
        }
      }
    }

    AsyncFunction("cancelDecodeJob") { jobId: String ->
      val job = jobs.remove(jobId)
      if (job != null) {
        cancellationCount += 1
        job.cancel()
        completedCleanupCount += 1
      }
      mapOf("cancelled" to (job != null), "jobId" to jobId)
    }

    AsyncFunction("cancelDecodeJobsForProvider") { providerId: String ->
      var cancelled = 0
      val iterator = jobs.entries.iterator()
      while (iterator.hasNext()) {
        val entry = iterator.next()
        if (entry.value.providerIdPublic == providerId) {
          iterator.remove()
          entry.value.cancel()
          cancellationCount += 1
          completedCleanupCount += 1
          cancelled += 1
        }
      }
      mapOf("cancelled" to cancelled, "providerId" to providerId)
    }

    OnDestroy {
      jobs.values.forEach { it.cancel() }
      cancellationCount += jobs.size
      jobs.clear()
    }
  }
}

private const val MAX_SERIES_SANITIZER_REPAIRS_PER_CATEGORY = 8
private const val SERIES_DECODER_AUDIT_TAG = "NovaCast Series Decoder Audit"

private data class SeriesEscapeRepair(
  val count: Int,
  val offset: Long,
  val kind: String,
)

/** Repairs malformed JSON escapes before JsonReader sees the response. */
private class SeriesJsonEscapeSanitizingReader(
  private val source: Reader,
  private val maxRepairs: Int,
  private val onRepair: (SeriesEscapeRepair) -> Unit,
) : Reader() {
  private var insideString = false
  private var sourceOffset = 0L
  private var repairCount = 0
  private var pendingSourceChar: Int? = null
  private val sourceBuffer = CharArray(4096)
  private var sourceBufferPosition = 0
  private var sourceBufferLimit = 0
  private val outputQueue = ArrayDeque<Int>()

  override fun read(cbuf: CharArray, off: Int, len: Int): Int {
    if (len == 0) return 0
    var count = 0
    while (count < len) {
      val next = nextSanitizedChar()
      if (next < 0) {
        return if (count == 0) -1 else count
      }
      cbuf[off + count] = next.toChar()
      count += 1
    }
    return count
  }

  override fun close() {
    source.close()
  }

  private fun readRaw(): Int {
    val pending = pendingSourceChar
    if (pending != null) {
      pendingSourceChar = null
      return pending
    }
    while (sourceBufferPosition >= sourceBufferLimit) {
      val readCount = source.read(sourceBuffer, 0, sourceBuffer.size)
      if (readCount < 0) return -1
      if (readCount == 0) continue
      sourceBufferPosition = 0
      sourceBufferLimit = readCount
    }
    val value = sourceBuffer[sourceBufferPosition++].code
    sourceOffset += 1
    return value
  }

  private fun nextSanitizedChar(): Int {
    if (outputQueue.isNotEmpty()) return outputQueue.removeFirst()
    val value = readRaw()
    if (value < 0) return value
    val char = value.toChar()

    if (!insideString) {
      if (char == '"') insideString = true
      return value
    }

    if (char == '"') {
      insideString = false
      return value
    }
    if (char != '\\') return value

    val escaped = readRaw()
    if (escaped < 0) {
      return repairedLiteral("\\\\", "truncated-escape")
    }
    if (escaped.toChar() != 'u') {
      return if (escaped.toChar() in VALID_SIMPLE_ESCAPES) {
        emitString("${char}${escaped.toChar()}")
      } else {
        repairedLiteral("\\\\${escaped.toChar()}", "invalid-simple-escape")
      }
    }

    val digits = StringBuilder(4)
    repeat(4) {
      val candidate = readRaw()
      if (candidate < 0) return malformedUnicodeLiteral(digits.toString(), "truncated-unicode-escape")
      val candidateChar = candidate.toChar()
      if (candidateChar == '"') {
        pendingSourceChar = candidate
        return malformedUnicodeLiteral(digits.toString(), "truncated-unicode-escape")
      }
      if (candidateChar !in HEX_DIGITS) {
        return malformedUnicodeLiteral(
          digits.append(candidateChar).toString(),
          "invalid-unicode-escape",
        )
      }
      digits.append(candidateChar)
    }

    // Valid \uXXXX is emitted unchanged.
    return emitString("\\u${digits}")
  }

  private fun malformedUnicodeLiteral(consumed: String, kind: String): Int {
    val literal = StringBuilder("\\\\u")
    consumed.forEach { char ->
      if (char == '\\') literal.append("\\\\") else literal.append(char)
    }
    return repairedLiteral(literal.toString(), kind)
  }

  private fun repairedLiteral(value: String, kind: String): Int {
    repairCount += 1
    onRepair(SeriesEscapeRepair(repairCount, sourceOffset, kind))
    if (repairCount > maxRepairs) {
      throw IOException("series_sanitizer_threshold_exceeded")
    }
    return emitString(value)
  }

  private fun emitString(value: String): Int {
    if (value.isEmpty()) return -1
    value.drop(1).forEach { outputQueue.addLast(it.code) }
    return value[0].code
  }

  companion object {
    private const val VALID_SIMPLE_ESCAPES = "\"\\/bfnrt"
    private const val HEX_DIGITS = "0123456789abcdefABCDEF"
  }
}

private data class DecodeBatch(
  val jobId: String,
  val items: List<Map<String, Any?>>,
  val done: Boolean,
  val cancelled: Boolean = false,
  val error: String? = null,
  val stats: Map<String, Any?> = emptyMap(),
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "jobId" to jobId,
    "items" to items,
    "done" to done,
    "cancelled" to cancelled,
    "error" to error,
    "stats" to stats,
  )
}

private class DecodeJob(
  val jobId: String,
  private val requestUrl: String,
  private val mediaType: String,
  private val filterCategoryId: String?,
  private val batchSize: Int,
  private val timeoutMs: Long,
  private val providerId: String,
  private val expectedProviderId: String,
  private val generation: Int?,
  private val categoryIndex: Int?,
  private val categoryPosition: Int?,
  private val totalCategoryCount: Int?,
  private val requestAttempt: Int,
  private val preserveLiveEpgChannelId: Boolean,
) {
  private val channel = Channel<DecodeBatch>(capacity = 0) // rendezvous backpressure
  private val cancelled = AtomicBoolean(false)
  private var producer: Job? = null
  val startedAtMs: Long = System.currentTimeMillis()
  val mediaTypePublic: String get() = mediaType
  val providerIdPublic: String get() = providerId
  val batchesEmittedPublic: Int get() = batchesEmitted

  private var headersMs = 0L
  private var downloadParseMs = 0L
  private var responseBytes = 0L
  private var rawSeen = 0
  private var matched = 0
  private var emptyCategoryIdCount = 0
  private var batchesEmitted = 0
  private var maxBatchSize = 0
  private var responseTopLevelType: String? = null
  private var responseKeys: List<String> = emptyList()
  private var arrayLength: Int? = null
  private var errorReason: String? = null
  private var sanitizerRepairCount = 0
  private var decoderStage = "queued"

  fun queuedBatchEstimate(): Int = if (channel.isEmpty) 0 else 1

  fun start(scope: CoroutineScope, onFinished: () -> Unit) {
    producer = scope.launch {
      try {
        if (expectedProviderId.isNotEmpty() && providerId.isNotEmpty() && expectedProviderId != providerId) {
          channel.send(
            DecodeBatch(
              jobId = jobId,
              items = emptyList(),
              done = true,
              error = "stale_provider",
            ),
          )
          return@launch
        }
        runDecode()
      } catch (error: CancellationException) {
        channel.trySend(
          DecodeBatch(jobId = jobId, items = emptyList(), done = true, cancelled = true),
        )
      } catch (error: Throwable) {
        if (mediaType == "series") {
          Log.w(
            SERIES_DECODER_AUDIT_TAG,
            "event=stream-read-failed categoryId=${filterCategoryId ?: "null"} " +
              "decoderStage=$decoderStage sanitizerRepairCount=$sanitizerRepairCount " +
              "readerType=${if (mediaType == "series") "SeriesJsonEscapeSanitizingReader" else "InputStreamReader"} " +
              "bufferState=decoder-managed-stream " +
              "exceptionClass=${error::class.java.simpleName} exceptionMessage=${error.message ?: "null"}",
          )
        }
        channel.trySend(
          DecodeBatch(
            jobId = jobId,
            items = emptyList(),
            done = true,
            error = error.message ?: "decode_failed",
            stats = snapshotStats(),
          ),
        )
      } finally {
        onFinished()
      }
    }
  }

  suspend fun pull(): DecodeBatch {
    if (cancelled.get()) {
      return DecodeBatch(jobId = jobId, items = emptyList(), done = true, cancelled = true)
    }
    return withTimeout(timeoutMs + 30_000L) {
      channel.receive()
    }
  }

  fun cancel() {
    cancelled.set(true)
    producer?.cancel()
    channel.cancel()
  }

  private suspend fun runDecode() {
    decoderStage = "open-connection"
    val started = System.currentTimeMillis()
    val connection = (URL(requestUrl).openConnection() as HttpURLConnection).apply {
      connectTimeout = timeoutMs.toInt().coerceAtMost(120_000)
      readTimeout = timeoutMs.toInt().coerceAtMost(180_000)
      requestMethod = "GET"
      instanceFollowRedirects = true
      setRequestProperty("Accept", "application/json")
    }

    try {
      decoderStage = "read-response-headers"
      val code = connection.responseCode
      headersMs = System.currentTimeMillis() - started
      if (code !in 200..299) {
        throw IllegalStateException("http_$code")
      }

      val parseStarted = System.currentTimeMillis()
      decoderStage = "stream-json"
      val input = BufferedInputStream(connection.inputStream)
      val inputReader = InputStreamReader(input, Charsets.UTF_8)
      val sanitizedReader = if (mediaType == "series") {
        SeriesJsonEscapeSanitizingReader(
          inputReader,
          MAX_SERIES_SANITIZER_REPAIRS_PER_CATEGORY,
        ) { repair ->
          sanitizerRepairCount = repair.count
          if (repair.count > MAX_SERIES_SANITIZER_REPAIRS_PER_CATEGORY) {
            errorReason = "series_sanitizer_threshold_exceeded"
            Log.w(
              SERIES_DECODER_AUDIT_TAG,
              "event=sanitizer-threshold-exceeded categoryId=${filterCategoryId ?: "null"} " +
                "sanitizerRepairCount=${repair.count} safePosition=${repair.offset} " +
                "escapeKind=${repair.kind}",
            )
          } else {
            Log.w(
              SERIES_DECODER_AUDIT_TAG,
              "event=${if (repair.kind.contains("unicode")) "malformed-unicode-escape-repaired" else "malformed-escape-repaired"} " +
                "categoryId=${filterCategoryId ?: "null"} " +
                "rowIndex=$rawSeen sanitizerRepairCount=${repair.count} safePosition=${repair.offset} " +
                "escapeKind=${repair.kind} replacementStrategy=literal-escaped-text",
            )
          }
        }
      } else {
        inputReader
      }
      JsonReader(sanitizedReader).use { reader ->
        decoderStage = "json-reader"
        when (reader.peek()) {
          JsonToken.BEGIN_ARRAY -> {
            responseTopLevelType = "array"
            reader.beginArray()
            val buffer = ArrayList<Map<String, Any?>>(batchSize)
            var matchedIndex = 0
            while (reader.hasNext()) {
              if (cancelled.get()) {
                reader.skipValue()
                continue
              }
              rawSeen += 1
              val item = readObject(reader)
              item ?: continue
              val itemCategory = stringField(item, "category_id")
              if (itemCategory.isNullOrEmpty()) {
                emptyCategoryIdCount += 1
              }
              if (!filterCategoryId.isNullOrEmpty() &&
                filterCategoryId != "all" &&
                !itemCategory.isNullOrEmpty() &&
                itemCategory != filterCategoryId
              ) {
                continue
              }
              matched += 1
              buffer.add(normalize(item, matchedIndex))
              matchedIndex += 1
              if (buffer.size >= batchSize) {
                emitBatch(buffer.toList(), done = false)
                buffer.clear()
              }
            }
            reader.endArray()
            arrayLength = rawSeen
            if (buffer.isNotEmpty()) {
              emitBatch(buffer.toList(), done = false)
              buffer.clear()
            }
          }
          JsonToken.BEGIN_OBJECT -> {
            responseTopLevelType = "object"
            reader.beginObject()
            val keys = ArrayList<String>(8)
            while (reader.hasNext()) {
              val key = reader.nextName()
              if (keys.size < 20) {
                keys.add(key)
              }
              reader.skipValue()
            }
            reader.endObject()
            responseKeys = keys
            errorReason = "top_level_object_not_supported"
            throw IllegalStateException("unexpected_json_object")
          }
          else -> {
            responseTopLevelType = reader.peek().name.lowercase()
            errorReason = "unsupported_top_level_token"
            reader.skipValue()
            throw IllegalStateException("unexpected_json")
          }
        }
      }
      downloadParseMs = System.currentTimeMillis() - parseStarted
      responseBytes = connection.contentLengthLong.coerceAtLeast(0L)

      emitBatch(emptyList(), done = true)
    } finally {
      connection.disconnect()
    }
  }

  private suspend fun emitBatch(items: List<Map<String, Any?>>, done: Boolean) {
    if (cancelled.get()) {
      channel.send(DecodeBatch(jobId = jobId, items = emptyList(), done = true, cancelled = true))
      throw CancellationException()
    }
    if (items.isNotEmpty()) {
      batchesEmitted += 1
      maxBatchSize = maxOf(maxBatchSize, items.size)
    }
    channel.send(
      DecodeBatch(
        jobId = jobId,
        items = items,
        done = done,
        stats = snapshotStats(),
      ),
    )
  }

  private fun snapshotStats(): Map<String, Any?> = mapOf(
    "headersMs" to headersMs,
    "downloadParseMs" to downloadParseMs,
    "responseBytes" to responseBytes,
    "rawSeen" to rawSeen,
    "matched" to matched,
    "emptyCategoryIdCount" to emptyCategoryIdCount,
    "batchesEmitted" to batchesEmitted,
    "maxBatchSize" to maxBatchSize,
    "batchSize" to batchSize,
    "mediaType" to mediaType,
    "responseTopLevelType" to responseTopLevelType,
    "responseKeys" to responseKeys,
    "arrayLength" to arrayLength,
    "errorReason" to errorReason,
    "generation" to generation,
    "categoryIndex" to categoryIndex,
    "categoryPosition" to categoryPosition,
    "totalCategoryCount" to totalCategoryCount,
    "requestAttempt" to requestAttempt,
    "sanitizerRepairCount" to sanitizerRepairCount,
  )

  private fun normalize(raw: Map<String, Any?>, index: Int): Map<String, Any?> {
    val title = stringField(raw, "name")?.trim().orEmpty()
    // Preserve stream category_id only. Never stamp filterCategoryId — JS falls back.
    // Stamping poisons SQLite UPSERT last-write-wins when panels ignore category filters.
    val streamCategoryId = stringField(raw, "category_id")
    return if (mediaType == "series") {
      val seriesId = stringField(raw, "series_id") ?: stringField(raw, "stream_id") ?: "series-$index"
      mapOf(
        "mediaType" to "series",
        "contentId" to seriesId,
        "seriesId" to seriesId,
        "categoryId" to streamCategoryId,
        "title" to title.ifEmpty { "Series ${index + 1}" },
        "artworkUrl" to firstString(raw, "cover", "stream_icon"),
        "backdropUrl" to firstString(raw, "backdrop_path"),
        "rating" to numberOrString(raw["rating"]),
        "releaseDate" to usableReleaseDate(firstString(raw, "releasedate", "releaseDate")),
        "releaseYear" to parseYear(raw),
        "addedAt" to unixTimestampMs(raw["added"]),
        "popularity" to finitePositiveNumber(raw["popularity"]),
        "providerSortOrder" to index,
        "streamExtension" to null,
      )
    } else {
      val streamId = stringField(raw, "stream_id") ?: "movie-$index"
      mapOf(
        "mediaType" to "movie",
        "contentId" to streamId,
        "categoryId" to streamCategoryId,
        "title" to title.ifEmpty { "Movie ${index + 1}" },
        "artworkUrl" to firstString(raw, "stream_icon", "cover", "movie_image"),
        "backdropUrl" to firstString(raw, "backdrop_path"),
        "rating" to numberOrString(raw["rating"]),
        "releaseDate" to usableReleaseDate(firstString(raw, "releasedate", "releaseDate")),
        "releaseYear" to parseYear(raw),
        "addedAt" to unixTimestampMs(raw["added"]),
        "popularity" to finitePositiveNumber(raw["popularity"]),
        "streamExtension" to stringField(raw, "container_extension"),
        "providerSortOrder" to index,
        "seriesId" to null,
      ) + if (preserveLiveEpgChannelId) mapOf("epgChannelId" to stringField(raw, "epg_channel_id")) else emptyMap()
    }
  }

  private fun readObject(reader: JsonReader): Map<String, Any?>? {
    if (reader.peek() != JsonToken.BEGIN_OBJECT) {
      reader.skipValue()
      return null
    }
    val out = HashMap<String, Any?>(16)
    reader.beginObject()
    while (reader.hasNext()) {
      val name = reader.nextName()
      when (reader.peek()) {
        JsonToken.STRING -> out[name] = reader.nextString()
        JsonToken.NUMBER -> {
          out[name] = reader.nextDouble()
        }
        JsonToken.BOOLEAN -> out[name] = reader.nextBoolean()
        JsonToken.NULL -> {
          reader.nextNull()
          out[name] = null
        }
        else -> reader.skipValue()
      }
    }
    reader.endObject()
    return out
  }

  private fun stringField(map: Map<String, Any?>, key: String): String? {
    val value = map[key] ?: return null
    return when (value) {
      is String -> value.trim().ifEmpty { null }
      is Number -> {
        val asDouble = value.toDouble()
        if (asDouble % 1.0 == 0.0) {
          asDouble.toLong().toString()
        } else {
          value.toString()
        }
      }
      else -> value.toString().trim().ifEmpty { null }
    }
  }

  private fun firstString(map: Map<String, Any?>, vararg keys: String): String? {
    for (key in keys) {
      val value = stringField(map, key)
      if (!value.isNullOrEmpty()) {
        // backdrop_path is sometimes a JSON array string — keep first URL-looking token only
        if (value.startsWith("[")) {
          val match = Regex("https?://[^\\\"\\]\\s]+").find(value)
          if (match != null) return match.value
          continue
        }
        return value
      }
    }
    return null
  }

  private fun usableReleaseDate(value: String?): String? {
    if (value.isNullOrBlank()) {
      return null
    }
    val trimmed = value.trim()
    if (trimmed.matches(Regex("0+")) || trimmed.startsWith("0000")) {
      return null
    }
    return trimmed
  }

  private fun parseYear(raw: Map<String, Any?>): Int? {
    val candidates = listOf(raw["year"], raw["releasedate"], raw["releaseDate"])
    for (candidate in candidates) {
      when (candidate) {
        is Number -> {
          val year = candidate.toInt()
          if (year in 1900..2100) {
            return year
          }
        }
        is String -> {
          val trimmed = candidate.trim()
          trimmed.toIntOrNull()?.let { year ->
            if (year in 1900..2100) {
              return year
            }
          }
          Regex("""\b(19|20)\d{2}\b""").find(trimmed)?.value?.toIntOrNull()?.let { return it }
        }
      }
    }
    return null
  }

  private fun unixTimestampMs(value: Any?): Long? {
    val raw = when (value) {
      is Number -> value.toLong()
      is String -> value.trim().toLongOrNull() ?: return null
      else -> return null
    }
    if (raw <= 0L) {
      return null
    }
    return if (raw < 1_000_000_000_000L) raw * 1000L else raw
  }

  private fun finitePositiveNumber(value: Any?): Double? {
    val parsed = when (value) {
      is Number -> value.toDouble()
      is String -> value.trim().toDoubleOrNull() ?: return null
      else -> return null
    }
    return if (parsed.isFinite() && parsed > 0.0) parsed else null
  }

  private fun numberOrString(value: Any?): Any? = when (value) {
    null -> null
    is Number -> value
    is String -> value.trim().ifEmpty { null }
    else -> value.toString()
  }
}
