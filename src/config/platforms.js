/**
 * Platform-specific configurations
 * Settings and features unique to each platform
 */

export default {
  whatsapp: {
    // Connection settings
    qrTimeout: 60000, // 60 seconds
    reconnectDelay: 5000, // 5 seconds
    
    // Message settings
    readMessages: false, // Auto-read messages
    readReceipts: true, // Send read receipts
    
    // Media settings
    maxMediaSize: 64 * 1024 * 1024, // 64MB
    downloadTimeout: 30000, // 30 seconds
    
    // Group settings
    autoAcceptInvites: false,
    leaveOnKick: true,
    
    // Features
    features: {
      reactions: true,
      polls: true,
      voiceMessages: true,
      statusReplies: false
    }
  }
};
