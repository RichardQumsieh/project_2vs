package com.sophia.messenger.call

import org.json.JSONObject

data class CallWake(val callId: String, val conversationId: String)

object CallWakeParser {
  fun read(data: Map<String, String>): CallWake? {
    if (data["kind"] == "call") {
      return wake(data["callId"], data["conversationId"])
    }
    val body = data["body"] ?: return null
    return try {
      val json = JSONObject(body)
      val nested = json.optJSONObject("data") ?: json
      if (nested.optString("kind") != "call") null
      else wake(nested.optString("callId"), nested.optString("conversationId"))
    } catch (_: Exception) {
      null
    }
  }

  private fun wake(callId: String?, conversationId: String?): CallWake? {
    if (callId.isNullOrEmpty() || conversationId.isNullOrEmpty()) return null
    return CallWake(callId, conversationId)
  }
}
