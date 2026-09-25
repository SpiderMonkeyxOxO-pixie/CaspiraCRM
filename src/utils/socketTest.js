// src/utils/socketTest.js
// Utility functions for testing socket connections

import socketService from '../services/socketService';

export const testSocketConnection = (userId, _token) => {
  console.log('Testing socket connection...');
  
  // Create a test connection
  const testSocket = socketService.connect(userId);
  
  // Set up test listeners
  socketService.on('connectionStatus', (status) => {
    console.log('Test Connection Status:', status);
  });
  
  socketService.on('newNotification', (notification) => {
    console.log('Test New Notification:', notification);
  });
  
  socketService.on('socketError', (error) => {
    console.error('Test Socket Error:', error);
  });
  
  // Test methods
  setTimeout(() => {
    console.log('Current connection status:', socketService.getConnectionStatus());
  }, 2000);
  
  // Clean up after 10 seconds
  setTimeout(() => {
    console.log('Cleaning up test connection...');
    socketService.disconnect();
  }, 10000);
  
  return testSocket;
};

export const simulateNotification = (notificationData) => {
  console.log('Simulating notification:', notificationData);
  
  // This would be called by your backend
  // For testing, you can manually trigger the event
  socketService.emit('newNotification', notificationData);
};

export const testAPIvsSocket = async (userId) => {
  console.log('Testing API vs Socket performance...');
  
  const startTime = Date.now();
  
  // Test socket connection
  const socketStart = Date.now();
  socketService.connect(userId);
  const socketTime = Date.now() - socketStart;
  
  console.log(`Socket connection time: ${socketTime}ms`);
  
  // Test API fallback (you would need to import your API function)
  // const apiStart = Date.now();
  // await fetchUserNotifications(userId);
  // const apiTime = Date.now() - apiStart;
  // console.log(`API fetch time: ${apiTime}ms`);
  
  const totalTime = Date.now() - startTime;
  console.log(`Total test time: ${totalTime}ms`);
};

// Example usage in browser console:
// testSocketConnection('your-user-id', 'your-token');
// simulateNotification({ _id: '1', title: 'Test', message: 'Test notification' });
