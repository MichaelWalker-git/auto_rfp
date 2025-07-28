import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Configuration
const API_BASE_URL = 'https://16lw6n3yr8.execute-api.us-east-1.amazonaws.com/prod';
const DOCUMENT_PROCESSING_URL = `${API_BASE_URL}/api/document-processing`;
const TEST_DOCUMENT_PATH = './test-rfp-document.txt';

// Test cases for different operations
const testCases = [
  {
    name: 'Document Q&A - Basic Question',
    operation: 'qa',
    question: 'What is the budget for this RFP project?',
    expectedKeywords: ['100000', '$100,000', 'budget']
  },
  {
    name: 'Document Q&A - Technical Requirements',
    operation: 'qa',
    question: 'What are the technical requirements for this project?',
    expectedKeywords: ['React', 'Node.js', 'PostgreSQL', 'AWS']
  },
  {
    name: 'Document Q&A - Timeline',
    operation: 'qa',
    question: 'What is the timeline for this project?',
    expectedKeywords: ['6 months', 'March 15, 2025', 'timeline']
  },
  {
    name: 'Document Summarization',
    operation: 'summarize',
    expectedKeywords: ['RFP', 'web application', 'Test Corp', 'AWS', 'React']
  },
  {
    name: 'Entity Extraction',
    operation: 'extract_entities',
    expectedKeywords: ['Test Corp', 'John Smith', 'March 15, 2025', 'React', 'AWS']
  }
];

/**
 * Create multipart/form-data request for document processing
 */
async function testDocumentProcessing(testCase) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log('─'.repeat(50));
  
  try {
    // Verify test document exists
    if (!fs.existsSync(TEST_DOCUMENT_PATH)) {
      throw new Error(`Test document not found: ${TEST_DOCUMENT_PATH}`);
    }

    // Create form data
    const formData = new FormData();
    formData.append('file', fs.createReadStream(TEST_DOCUMENT_PATH), {
      filename: 'test-rfp-document.txt',
      contentType: 'text/plain'
    });
    formData.append('operation', testCase.operation);
    
    // Add question for Q&A operations
    if (testCase.question) {
      formData.append('question', testCase.question);
    }

    // Make request
    console.log(`📡 Request: POST ${DOCUMENT_PROCESSING_URL}`);
    console.log(`📋 Operation: ${testCase.operation}`);
    if (testCase.question) {
      console.log(`❓ Question: ${testCase.question}`);
    }
    
    const startTime = Date.now();
    const response = await fetch(DOCUMENT_PROCESSING_URL, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });
    
    const processingTime = Date.now() - startTime;
    console.log(`⏱️  Processing Time: ${processingTime}ms`);
    console.log(`📊 Status: ${response.status} ${response.statusText}`);

    // Parse response
    const responseText = await response.text();
    let result;
    
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.log(`❌ JSON Parse Error:`, parseError.message);
      console.log(`📝 Raw Response:`, responseText.substring(0, 500));
      return false;
    }

    // Check for errors
    if (!response.ok) {
      console.log(`❌ API Error:`, result.error || result.message || 'Unknown error');
      return false;
    }

    // Validate response structure
    if (!result.result && !result.answer && !result.summary && !result.entities) {
      console.log(`❌ Invalid response structure:`, result);
      return false;
    }

    // Extract the actual content based on operation
    let content = '';
    switch (testCase.operation) {
      case 'qa':
        content = result.answer || result.result || '';
        break;
      case 'summarize':
        content = result.summary || result.result || '';
        break;
      case 'extract_entities':
        content = JSON.stringify(result.entities || result.result || '');
        break;
      default:
        content = result.result || '';
    }

    console.log(`✅ Success! Response received:`);
    console.log(`📄 Content: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);
    
    // Validate expected keywords
    const foundKeywords = [];
    const missingKeywords = [];
    
    testCase.expectedKeywords.forEach(keyword => {
      if (content.toLowerCase().includes(keyword.toLowerCase())) {
        foundKeywords.push(keyword);
      } else {
        missingKeywords.push(keyword);
      }
    });
    
    console.log(`🔍 Keywords Found: ${foundKeywords.length}/${testCase.expectedKeywords.length}`);
    if (foundKeywords.length > 0) {
      console.log(`  ✅ Found: ${foundKeywords.join(', ')}`);
    }
    if (missingKeywords.length > 0) {
      console.log(`  ⚠️  Missing: ${missingKeywords.join(', ')}`);
    }
    
    // Calculate success rate
    const successRate = (foundKeywords.length / testCase.expectedKeywords.length) * 100;
    console.log(`📈 Accuracy: ${successRate.toFixed(1)}%`);
    
    return {
      success: true,
      processingTime,
      contentLength: content.length,
      successRate,
      foundKeywords: foundKeywords.length,
      totalKeywords: testCase.expectedKeywords.length,
      content: content.substring(0, 500) // Store first 500 chars for analysis
    };

  } catch (error) {
    console.log(`❌ Test Failed:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test basic API connectivity
 */
async function testAPIConnectivity() {
  console.log(`\n🔌 Testing API Connectivity`);
  console.log('─'.repeat(50));
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/organizations`);
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Organizations API working - Found ${Array.isArray(data) ? data.length : 'unknown'} organizations`);
      return true;
    } else {
      console.log(`❌ Organizations API failed`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Connectivity failed:`, error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log(`🚀 Starting Document Processing Tests`);
  console.log(`📍 Endpoint: ${DOCUMENT_PROCESSING_URL}`);
  console.log(`📄 Test Document: ${TEST_DOCUMENT_PATH} (${fs.statSync(TEST_DOCUMENT_PATH).size} bytes)`);
  console.log('═'.repeat(70));

  // Test API connectivity first
  const connectivityOk = await testAPIConnectivity();
  if (!connectivityOk) {
    console.log(`\n❌ Aborting tests - API connectivity failed`);
    return;
  }

  // Run document processing tests
  const results = [];
  
  for (const testCase of testCases) {
    const result = await testDocumentProcessing(testCase);
    results.push({ testCase: testCase.name, result });
    
    // Brief pause between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log(`\n📊 TEST SUMMARY`);
  console.log('═'.repeat(70));
  
  const successfulTests = results.filter(r => r.result.success);
  const failedTests = results.filter(r => !r.result.success);
  
  console.log(`✅ Successful Tests: ${successfulTests.length}/${results.length}`);
  console.log(`❌ Failed Tests: ${failedTests.length}/${results.length}`);
  
  if (successfulTests.length > 0) {
    console.log(`\n📈 Performance Metrics:`);
    const avgTime = successfulTests.reduce((sum, r) => sum + (r.result.processingTime || 0), 0) / successfulTests.length;
    const avgAccuracy = successfulTests.reduce((sum, r) => sum + (r.result.successRate || 0), 0) / successfulTests.length;
    
    console.log(`  ⏱️  Average Processing Time: ${avgTime.toFixed(0)}ms`);
    console.log(`  🎯 Average Accuracy: ${avgAccuracy.toFixed(1)}%`);
    console.log(`  📄 Content Generation: Working`);
  }
  
  if (failedTests.length > 0) {
    console.log(`\n❌ Failed Tests:`);
    failedTests.forEach(test => {
      console.log(`  • ${test.testCase}: ${test.result.error || 'Unknown error'}`);
    });
  }
  
  // Overall status
  const overallSuccess = (successfulTests.length / results.length) * 100;
  console.log(`\n🎯 OVERALL SUCCESS RATE: ${overallSuccess.toFixed(1)}%`);
  
  if (overallSuccess >= 80) {
    console.log(`🎉 EXCELLENT! Document processing is working well.`);
  } else if (overallSuccess >= 60) {
    console.log(`⚠️  GOOD: Document processing is functional but needs improvement.`);
  } else {
    console.log(`❌ NEEDS ATTENTION: Document processing has significant issues.`);
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

export { testDocumentProcessing, runAllTests };
