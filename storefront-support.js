let contactRequestId;
let contactSubmitting = false;

async function submitContact(event) {
  event.preventDefault();
  const form = document.getElementById('contactForm');
  if (contactSubmitting || !form.reportValidity()) return;
  const button = document.getElementById('contactSubmit');
  const status = document.getElementById('contactStatus');
  contactSubmitting = true;
  button.disabled = true;
  button.textContent = 'Sending…';
  status.textContent = '';
  contactRequestId ||= crypto.randomUUID();
  try {
    const response = await fetch('/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), requestId: contactRequestId }),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'We could not send your message. Please retry or use the email link below.');
    status.textContent = 'Your message has been submitted to support. Keep an eye on your inbox for our reply.';
    status.style.color = '#07804d';
    form.reset();
    contactRequestId = undefined;
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'The request timed out. Your message is still here. Retry to check submission, or email support@aupeptidelab.com.'
      : error.message;
    status.style.color = '#b91c1c';
  } finally {
    contactSubmitting = false;
    button.disabled = false;
    button.textContent = 'Send Message';
  }
}

function requestBatchDocumentation() {
  showPage('contact');
  document.getElementById('contactTopic').value = 'Batch Certificate Request';
  document.getElementById('contactMessage').focus();
}
