/* ==========================================================================
   Feedback & support request submission.
   ========================================================================== */

function bindFeedbackForm() {
  const form = document.getElementById('feedbackForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      category: document.getElementById('feedbackCategory').value,
      subject: document.getElementById('feedbackSubject').value,
      message: document.getElementById('feedbackMessage').value
    };

    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        alert(`Failed to submit request: ${await readError(res)}`);
        return;
      }

      const data = await res.json();
      alert(`Support request submitted. Reference #${data.id}`);
      form.reset();
    } catch (err) {
      alert(`Network Error: ${err.message}`);
    }
  });
}
