package com.sophia.messenger.call

import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Starts the full-screen call UI from a high-priority data message when JS is not running. */
class SophiaFirebaseMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val wake = CallWakeParser.read(message.data) ?: return
    val intent = Intent(this, CallForegroundService::class.java).apply {
      action = CallForegroundService.ACTION_INCOMING
      putExtra(CallForegroundService.EXTRA_CALL_ID, wake.callId)
      putExtra(CallForegroundService.EXTRA_CONVERSATION_ID, wake.conversationId)
    }
    ContextCompat.startForegroundService(this, intent)
  }
}
