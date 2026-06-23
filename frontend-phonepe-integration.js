// ============================================
// Frontend Integration Guide - PhonePe Payment
// ============================================

/**
 * STEP 1: Check Available Payment Gateways
 * Call this on checkout page to show available payment methods
 */
async function loadAvailablePaymentGateways() {
  try {
    const response = await fetch('/api/config/payment-gateways');
    const data = await response.json();
    
    if (data.success) {
      console.log('Available Gateways:', data.available);
      console.log('Configured:', data.configured);
      
      // Show payment method buttons based on availability
      if (data.available.includes('PhonePe')) {
        // Show PhonePe button
        document.getElementById('phonepe-button').style.display = 'block';
      }
      
      if (data.available.includes('PayU')) {
        // Show PayU button
        document.getElementById('payu-button').style.display = 'block';
      }
      
      if (data.available.includes('COD')) {
        // Show COD option
        document.getElementById('cod-button').style.display = 'block';
      }
    }
  } catch (error) {
    console.error('Failed to load payment gateways:', error);
  }
}

/**
 * STEP 2: Create Order with PhonePe Payment
 * User selects PhonePe as payment method and clicks checkout
 */
async function createPhonePeOrder(addressId, cartItemIds, couponCode = '') {
  try {
    const authToken = localStorage.getItem('authToken');
    
    const response = await fetch('/api/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        address_id: addressId,
        payment_method: 'Prepaid',
        payment_gateway: 'PhonePe', // Important: Specify PhonePe
        cart_item_ids: cartItemIds,
        coupon_code: couponCode
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Failed to create order');
    }

    console.log('Order created:', {
      orderId: data.orderId,
      orderReference: data.orderReference,
      merchantOrderId: data.merchantOrderId
    });

    // Store order ID for later use
    localStorage.setItem('currentOrderId', data.orderId);
    localStorage.setItem('currentOrderReference', data.orderReference);

    return data;
  } catch (error) {
    console.error('Order creation failed:', error);
    alert('Failed to create order: ' + error.message);
    throw error;
  }
}

/**
 * STEP 3: Initiate PhonePe Payment
 * Once order is created, initiate the payment
 */
async function initiatePhonePePayment(orderId) {
  try {
    const authToken = localStorage.getItem('authToken');

    const response = await fetch('/api/phonepe/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        order_id: orderId
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Failed to initiate payment');
    }

    console.log('Payment initiated:', {
      redirectUrl: data.redirectUrl,
      merchantOrderId: data.merchantOrderId,
      phonepeOrderId: data.phonepeOrderId
    });

    // Store transaction details
    localStorage.setItem('currentPhonePeOrderId', data.phonepeOrderId);
    localStorage.setItem('currentMerchantOrderId', data.merchantOrderId);

    // Redirect to PhonePe
    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
    } else {
      throw new Error('No redirect URL returned from payment initiation');
    }

    return data;
  } catch (error) {
    console.error('Payment initiation failed:', error);
    alert('Failed to initiate payment: ' + error.message);
    throw error;
  }
}

/**
 * STEP 4: Check Payment Status
 * After payment is completed, check the status
 */
async function checkPhonePePaymentStatus(orderId) {
  try {
    const authToken = localStorage.getItem('authToken');

    const response = await fetch(`/api/phonepe/status/${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Failed to check payment status');
    }

    const transaction = data.transaction;
    console.log('Payment Status:', {
      state: transaction.state,
      transactionState: transaction.transactionState,
      paymentMode: transaction.paymentMode,
      amount: transaction.amount
    });

    return transaction;
  } catch (error) {
    console.error('Failed to check payment status:', error);
    throw error;
  }
}

/**
 * COMPLETE CHECKOUT FLOW
 * This is what happens when user clicks "Pay with PhonePe" button
 */
async function completePhonePeCheckout(addressId, cartItemIds, couponCode = '') {
  try {
    // Show loading indicator
    showLoadingSpinner(true);

    console.log('Starting PhonePe checkout...');

    // Step 1: Create order
    const orderData = await createPhonePeOrder(addressId, cartItemIds, couponCode);
    const orderId = orderData.orderId;

    console.log(`Order created: #${orderId}`);

    // Step 2: Initiate payment (this will redirect to PhonePe)
    const paymentData = await initiatePhonePePayment(orderId);

    console.log('Payment initiated, redirecting to PhonePe...');
    // User is now redirected to PhonePe payment gateway
    // After payment, PhonePe will redirect back to callback endpoint

  } catch (error) {
    showLoadingSpinner(false);
    console.error('Checkout failed:', error);
    // Show error message to user
    showErrorMessage(error.message);
  }
}

/**
 * HANDLE SUCCESSFUL PAYMENT
 * This is shown after user completes payment and returns from PhonePe
 */
function handlePaymentSuccess() {
  const orderId = new URLSearchParams(window.location.search).get('orderId');
  const orderReference = new URLSearchParams(window.location.search).get('reference');

  if (orderId) {
    console.log(`Payment successful for order #${orderId} (${orderReference})`);
    
    // Clear cart
    clearUserCart();
    
    // Show success message
    showSuccessMessage(`Payment successful! Order reference: ${orderReference}`);
    
    // Redirect to order tracking
    setTimeout(() => {
      window.location.href = `/track-order.html?orderId=${orderId}&reference=${orderReference}`;
    }, 3000);
  }
}

/**
 * HANDLE FAILED PAYMENT
 * This is shown if payment fails or is cancelled
 */
function handlePaymentFailure() {
  const params = new URLSearchParams(window.location.search);
  const paymentFailed = params.get('payment') === 'failed';

  if (paymentFailed) {
    const message = params.get('message') || 'Payment failed. Please try again.';
    console.log('Payment failed:', message);
    
    // Show error message
    showErrorMessage(message);
    
    // Allow retry
    setTimeout(() => {
      window.location.href = '/cart.html';
    }, 3000);
  }
}

/**
 * RETRY PAYMENT
 * If payment failed, allow user to retry
 */
async function retryPhonePePayment(orderId) {
  try {
    showLoadingSpinner(true);
    
    console.log(`Retrying payment for order #${orderId}`);
    
    const paymentData = await initiatePhonePePayment(orderId);
    // This will redirect to PhonePe again
    
  } catch (error) {
    showLoadingSpinner(false);
    showErrorMessage('Failed to retry payment: ' + error.message);
  }
}

// ============================================
// HTML Integration Examples
// ============================================

/*
<!-- Checkout Page HTML -->

<div id="payment-methods" class="payment-methods">
  <h3>Select Payment Method</h3>
  
  <!-- PhonePe Option -->
  <div id="phonepe-option" style="display: none;">
    <button id="phonepe-button" onclick="handlePhonePeSelection()">
      <img src="/images/phonepe-logo.png" alt="PhonePe">
      <span>PhonePe - UPI, Cards, Wallet</span>
    </button>
  </div>
  
  <!-- PayU Option -->
  <div id="payu-option" style="display: none;">
    <button id="payu-button" onclick="handlePayUSelection()">
      <img src="/images/payu-logo.png" alt="PayU">
      <span>PayU - Cards, Wallet</span>
    </button>
  </div>
  
  <!-- COD Option -->
  <div id="cod-option" style="display: none;">
    <button id="cod-button" onclick="handleCODSelection()">
      <img src="/images/cod-logo.png" alt="COD">
      <span>Cash on Delivery</span>
    </button>
  </div>
</div>

<div id="checkout-button">
  <button onclick="proceedToPayment()" class="btn-primary">
    Proceed to Payment
  </button>
</div>

<!-- Loading Spinner -->
<div id="loading-spinner" style="display: none;">
  <div class="spinner"></div>
  <p>Processing your payment...</p>
</div>

<!-- Error Message -->
<div id="error-message" style="display: none;" class="alert alert-danger">
  <p id="error-text"></p>
</div>

<!-- Success Message -->
<div id="success-message" style="display: none;" class="alert alert-success">
  <p id="success-text"></p>
</div>
*/

// ============================================
// On Page Load
// ============================================

// Initialize payment methods when checkout page loads
document.addEventListener('DOMContentLoaded', function() {
  loadAvailablePaymentGateways();
  
  // Check if returning from payment
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('payment') === 'success') {
    handlePaymentSuccess();
  } else if (urlParams.get('payment') === 'failed') {
    handlePaymentFailure();
  }
});

// ============================================
// Helper Functions
// ============================================

function showLoadingSpinner(show) {
  const spinner = document.getElementById('loading-spinner');
  if (spinner) {
    spinner.style.display = show ? 'block' : 'none';
  }
}

function showErrorMessage(message) {
  const errorDiv = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');
  
  if (errorDiv && errorText) {
    errorText.textContent = message;
    errorDiv.style.display = 'block';
  }
}

function showSuccessMessage(message) {
  const successDiv = document.getElementById('success-message');
  const successText = document.getElementById('success-text');
  
  if (successDiv && successText) {
    successText.textContent = message;
    successDiv.style.display = 'block';
  }
}

function handlePhonePeSelection() {
  localStorage.setItem('selectedPaymentMethod', 'PhonePe');
  document.getElementById('phonepe-button').classList.add('selected');
  document.getElementById('payu-button')?.classList.remove('selected');
  document.getElementById('cod-button')?.classList.remove('selected');
}

function handlePayUSelection() {
  localStorage.setItem('selectedPaymentMethod', 'PayU');
  document.getElementById('payu-button').classList.add('selected');
  document.getElementById('phonepe-button')?.classList.remove('selected');
  document.getElementById('cod-button')?.classList.remove('selected');
}

function handleCODSelection() {
  localStorage.setItem('selectedPaymentMethod', 'COD');
  document.getElementById('cod-button').classList.add('selected');
  document.getElementById('phonepe-button')?.classList.remove('selected');
  document.getElementById('payu-button')?.classList.remove('selected');
}

async function proceedToPayment() {
  const selectedMethod = localStorage.getItem('selectedPaymentMethod');
  const addressId = localStorage.getItem('selectedAddressId');
  const cartItemIds = JSON.parse(localStorage.getItem('cartItemIds') || '[]');
  const couponCode = localStorage.getItem('appliedCouponCode') || '';

  if (!selectedMethod) {
    showErrorMessage('Please select a payment method');
    return;
  }

  if (!addressId) {
    showErrorMessage('Please select a delivery address');
    return;
  }

  if (cartItemIds.length === 0) {
    showErrorMessage('Your cart is empty');
    return;
  }

  if (selectedMethod === 'PhonePe') {
    completePhonePeCheckout(addressId, cartItemIds, couponCode);
  } else if (selectedMethod === 'PayU') {
    completePayUCheckout(addressId, cartItemIds, couponCode);
  } else if (selectedMethod === 'COD') {
    completeCODCheckout(addressId, cartItemIds, couponCode);
  }
}

function clearUserCart() {
  localStorage.removeItem('cartItemIds');
  // Also clear from server if needed
}
