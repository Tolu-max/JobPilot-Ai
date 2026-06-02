document.getElementById('extractBtn').addEventListener('click', async () => {
  const domains = ['linkedin.com', 'glassdoor.com', 'indeed.com'];
  let allCookies = [];

  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    
    const formatted = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expirationDate || -1,
      size: c.name.length + c.value.length,
      httpOnly: c.httpOnly,
      secure: c.secure,
      session: c.session,
      sameSite: c.sameSite === 'no_restriction' ? 'None' : 
                c.sameSite === 'lax' ? 'Lax' : 
                c.sameSite === 'strict' ? 'Strict' : 'Lax'
    }));

    allCookies = allCookies.concat(formatted);
  }

  const output = document.getElementById('cookieOutput');
  output.value = JSON.stringify(allCookies, null, 2);
  
  document.getElementById('resultContainer').classList.remove('hidden');
});

document.getElementById('copyBtn').addEventListener('click', () => {
  const output = document.getElementById('cookieOutput');
  output.select();
  document.execCommand('copy');
  
  const btn = document.getElementById('copyBtn');
  const originalText = btn.innerText;
  btn.innerText = 'Copied!';
  btn.style.backgroundColor = '#059669';
  
  setTimeout(() => {
    btn.innerText = originalText;
    btn.style.backgroundColor = '#10b981';
  }, 2000);
});
