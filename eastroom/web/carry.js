// The app was called Devour at first. What a device kept under that name (its record of your reading, your place, your settings) is carried over, once.
try { for (const k of Object.keys(localStorage)) if (k.startsWith('devour:')) { const to = 'eastroom:' + k.slice(7); if (localStorage.getItem(to) == null) localStorage.setItem(to, localStorage.getItem(k)); localStorage.removeItem(k); } } catch {}
