package com.sophia.messenger.call

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.getStringExtra(CallForegroundService.EXTRA_ACTION) ?: return
    val callId = intent.getStringExtra(CallForegroundService.EXTRA_CALL_ID) ?: ""
    val conversationId = intent.getStringExtra(CallForegroundService.EXTRA_CONVERSATION_ID) ?: ""
    val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence("reply_text")?.toString()
    SophiaCallStore.set(CallAction(action, callId, conversationId, reply))
    if (action == "decline" || action == "hangup") {
      context.startService(Intent(context, CallForegroundService::class.java).setAction(CallForegroundService.ACTION_STOP))
      context.getSystemService(NotificationManager::class.java)?.cancel(conversationId.hashCode())
    }
    val open = Intent().setClassName(context, "com.sophia.messenger.MainActivity").apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra(CallForegroundService.EXTRA_ACTION, action)
      putExtra(CallForegroundService.EXTRA_CALL_ID, callId)
      putExtra(CallForegroundService.EXTRA_CONVERSATION_ID, conversationId)
    }
    context.startActivity(open)
  }
}
