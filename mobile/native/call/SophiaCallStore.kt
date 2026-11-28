package com.sophia.messenger.call

data class CallAction(
  val action: String,
  val callId: String,
  val conversationId: String,
  val reply: String?,
)

object SophiaCallStore {
  @Volatile
  private var pending: CallAction? = null

  fun set(action: CallAction) {
    pending = action
  }

  fun consume(): CallAction? {
    val current = pending
    pending = null
    return current
  }
}
