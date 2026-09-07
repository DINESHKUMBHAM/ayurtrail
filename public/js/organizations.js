/* ==========================================================================
   Research organizations: the participating-sites register.
   ========================================================================== */

const ORG_TABLE_COLUMNS = 6;

// Mirrors the server-side rule on POST /api/organizations.
const ORG_CREATION_ROLES = ['PI', 'ADMIN'];

const ORG_TYPE_LABELS = {
  ACADEMIC: 'Academic Institute',
  HOSPITAL: 'Hospital',
  CRO: 'Contract Research Org',
  GOVERNMENT: 'Government Body',
  INDUSTRY: 'Industry Sponsor'
};

function canCreateOrganizations() {
  const user = getCurrentUser();
  return Boolean(user && ORG_CREATION_ROLES.includes(user.role));
}

function applyOrgFormVisibility() {
  const card = document.getElementById('orgFormCard');
  if (card) card.hidden = !canCreateOrganizations();
}

async function loadOrganizations() {
  applyOrgFormVisibility();

  const tbody = document.getElementById('orgTableBody');
  if (!tbody) return;

  const activeOnly = document.getElementById('orgActiveOnly');
  const url = activeOnly && activeOnly.checked
    ? '/api/organizations?status=ACTIVE'
    : '/api/organizations';

  renderTableMessage(tbody, ORG_TABLE_COLUMNS, 'Loading organizations...');

  try {
    const res = await apiFetch(url);
    if (!res.ok) {
      renderTableMessage(tbody, ORG_TABLE_COLUMNS, await readError(res, 'Failed to load organizations.'), true);
      return;
    }

    const orgs = await res.json();
    if (orgs.length === 0) {
      renderTableMessage(
        tbody,
        ORG_TABLE_COLUMNS,
        activeOnly && activeOnly.checked
          ? 'No active organizations registered yet.'
          : 'No organizations registered yet.'
      );
      return;
    }

    tbody.innerHTML = orgs.map(o => `
      <tr>
        <td><strong>${o.org_code}</strong></td>
        <td>${o.name}</td>
        <td>${ORG_TYPE_LABELS[o.org_type] || o.org_type}</td>
        <td>${o.city || '--'}</td>
        <td>${o.contact_email ? `<a href="mailto:${o.contact_email}">${o.contact_email}</a>` : '--'}</td>
        <td>
          <span class="badge ${o.status === 'ACTIVE' ? 'badge-locked' : 'badge-neutral'}">${o.status}</span>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    renderTableMessage(tbody, ORG_TABLE_COLUMNS, `Error loading organizations: ${err.message}`, true);
  }
}

function bindOrgForm() {
  const filter = document.getElementById('orgActiveOnly');
  if (filter) filter.addEventListener('change', loadOrganizations);

  const form = document.getElementById('orgForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      org_code: document.getElementById('orgCode').value,
      name: document.getElementById('orgName').value,
      org_type: document.getElementById('orgType').value,
      city: document.getElementById('orgCity').value,
      contact_email: document.getElementById('orgEmail').value,
      status: document.getElementById('orgStatus').value
    };

    try {
      const res = await apiFetch('/api/organizations', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        alert(`Failed to register organization: ${await readError(res)}`);
        return;
      }

      const data = await res.json();
      alert(`Organization registered: ${data.org_code}`);
      form.reset();
      loadOrganizations();
    } catch (err) {
      alert(`Network Error: ${err.message}`);
    }
  });
}
