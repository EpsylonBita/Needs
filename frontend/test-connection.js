// Test script to check if the backend is accessible
const API_URL = 'http://localhost:3002';

console.log(`Testing connection to backend at ${API_URL}...`);
console.log('------------------------');

// Try the root endpoint
fetch(`${API_URL}/`)
  .then(response => {
    console.log(`Root endpoint (${API_URL}/): ${response.status} ${response.statusText}`);
    return response.text();
  })
  .then(text => {
    console.log('Response:', text.substring(0, 100) + '...');
  })
  .catch(error => {
    console.error(`Error connecting to root endpoint: ${error.message}`);
  });

// Try the health endpoint
setTimeout(() => {
  fetch(`${API_URL}/health`)
    .then(response => {
      console.log(`Health endpoint (${API_URL}/health): ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      console.log('Health data:', data);
    })
    .catch(error => {
      console.error(`Error connecting to health endpoint: ${error.message}`);
    });
}, 1000);

// Try the API health endpoint
setTimeout(() => {
  fetch(`${API_URL}/api/health`)
    .then(response => {
      console.log(`API Health endpoint (${API_URL}/api/health): ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      console.log('API Health data:', data);
    })
    .catch(error => {
      console.error(`Error connecting to API health endpoint: ${error.message}`);
    });
}, 2000);

console.log('------------------------');
console.log('If all requests fail with network errors, it means the backend server is either:');
console.log('1. Not running');
console.log('2. Running on a different port');
console.log('3. Has firewall or CORS issues');
console.log('------------------------'); 