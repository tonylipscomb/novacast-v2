package expo.modules.novacastcatalogdecode

import android.util.JsonReader
import android.util.JsonToken
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
import java.io.InputStreamReader
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
  private var batchesEmitted = 0
  private var maxBatchSize = 0

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
        channel.trySend(
          DecodeBatch(
            jobId = jobId,
            items = emptyList(),
            done = true,
            error = error.message ?: "decode_failed",
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
    val started = System.currentTimeMillis()
    val connection = (URL(requestUrl).openConnection() as HttpURLConnection).apply {
      connectTimeout = timeoutMs.toInt().coerceAtMost(120_000)
      readTimeout = timeoutMs.toInt().coerceAtMost(180_000)
      requestMethod = "GET"
      instanceFollowRedirects = true
      setRequestProperty("Accept", "application/json")
    }

    try {
      val code = connection.responseCode
      headersMs = System.currentTimeMillis() - started
      if (code !in 200..299) {
        throw IllegalStateException("http_$code")
      }

      val parseStarted = System.currentTimeMillis()
      val input = BufferedInputStream(connection.inputStream)
      JsonReader(InputStreamReader(input, Charsets.UTF_8)).use { reader ->
        when (reader.peek()) {
          JsonToken.BEGIN_ARRAY -> {
            reader.beginArray()
            val buffer = ArrayList<Map<String, Any?>>(batchSize)
            var matchedIndex = 0
            while (reader.hasNext()) {
              if (cancelled.get()) {
                reader.skipValue()
                continue
              }
              rawSeen += 1
              val item = readObject(reader) ?: continue
              val itemCategory = stringField(item, "category_id")
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
            if (buffer.isNotEmpty()) {
              emitBatch(buffer.toList(), done = false)
              buffer.clear()
            }
          }
          JsonToken.BEGIN_OBJECT -> {
            // Some panels wrap arrays; skip unsupported shapes with a clear error.
            reader.skipValue()
            throw IllegalStateException("unexpected_json_object")
          }
          else -> {
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
    "batchesEmitted" to batchesEmitted,
    "maxBatchSize" to maxBatchSize,
    "batchSize" to batchSize,
    "mediaType" to mediaType,
  )

  private fun normalize(raw: Map<String, Any?>, index: Int): Map<String, Any?> {
    val title = stringField(raw, "name")?.trim().orEmpty()
    return if (mediaType == "series") {
      val seriesId = stringField(raw, "series_id") ?: stringField(raw, "stream_id") ?: "series-$index"
      mapOf(
        "mediaType" to "series",
        "contentId" to seriesId,
        "seriesId" to seriesId,
        "categoryId" to (stringField(raw, "category_id") ?: filterCategoryId),
        "title" to title.ifEmpty { "Series ${index + 1}" },
        "artworkUrl" to firstString(raw, "cover", "stream_icon"),
        "backdropUrl" to firstString(raw, "backdrop_path"),
        "rating" to numberOrString(raw["rating"]),
        "releaseDate" to firstString(raw, "releasedate", "releaseDate"),
        "providerSortOrder" to index,
        "streamExtension" to null,
      )
    } else {
      val streamId = stringField(raw, "stream_id") ?: "movie-$index"
      mapOf(
        "mediaType" to "movie",
        "contentId" to streamId,
        "categoryId" to (stringField(raw, "category_id") ?: filterCategoryId),
        "title" to title.ifEmpty { "Movie ${index + 1}" },
        "artworkUrl" to firstString(raw, "stream_icon", "cover", "movie_image"),
        "backdropUrl" to firstString(raw, "backdrop_path"),
        "rating" to numberOrString(raw["rating"]),
        "releaseDate" to firstString(raw, "releasedate", "releaseDate"),
        "streamExtension" to stringField(raw, "container_extension"),
        "providerSortOrder" to index,
        "seriesId" to null,
      )
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

  private fun numberOrString(value: Any?): Any? = when (value) {
    null -> null
    is Number -> value
    is String -> value.trim().ifEmpty { null }
    else -> value.toString()
  }
}
