const express = require('express');
require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = 10;

const publicDir = path.join(__dirname, 'public');
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'zandygege@gmail.com';
const SITE_URL = process.env.SITE_URL || 'https://portofolio-alfachridzy.vercel.app';
const FORM_SERVICE_URL = process.env.FORM_SERVICE_URL || `https://formsubmit.co/ajax/${CONTACT_TO_EMAIL}`;

app.use(express.json({ limit: '30kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(publicDir));

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateContactPayload(payload) {
  const nama = cleanText(payload.nama);
  const email = cleanText(payload.email).toLowerCase();
  const kategori = cleanText(payload.kategori);
  const pesan = cleanText(payload.pesan);
  const errors = {};

  if (nama.length < 3) {
    errors.nama = 'Nama minimal 3 karakter.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Email belum valid.';
  }

  if (kategori.length < 3) {
    errors.kategori = 'Pilih kategori pesan.';
  }

  if (pesan.length < 10) {
    errors.pesan = 'Pesan minimal 10 karakter.';
  }

  if (pesan.length > 1000) {
    errors.pesan = 'Pesan maksimal 1000 karakter.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    data: { nama, email, kategori, pesan }
  };
}

function buildEmailContent(entry) {
  const jsonMessage = JSON.stringify(entry, null, 2);

  return {
    _subject: `[Portofolio] Pesan dari ${entry.nama}`,
    _template: 'table',
    _captcha: 'false',
    _replyto: entry.email,
    messages_json: jsonMessage,
    id: entry.id,
    nama: entry.nama,
    email: entry.email,
    kategori: entry.kategori,
    pesan: entry.pesan,
    createdAt: entry.createdAt,
    userAgent: entry.userAgent || '-'
  };
}

async function sendContactEmail(entry) {
  const response = await fetch(FORM_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: SITE_URL,
      Referer: `${SITE_URL}/`
    },
    body: JSON.stringify(buildEmailContent(entry))
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(result.message || 'Email belum berhasil dikirim.');
    error.statusCode = response.status;
    error.details = result;
    throw error;
  }

  if (String(result.success).toLowerCase() === 'false' && !/activation/i.test(result.message || '')) {
    const error = new Error(result.message || 'Email belum berhasil dikirim.');
    error.statusCode = 502;
    error.details = result;
    throw error;
  }

  return result;
}

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Backend portofolio Alfachridzy berjalan normal.'
  });
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.post('/api/contact', async (req, res) => {
  const validation = validateContactPayload(req.body || {});

  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Data yang dikirim belum lengkap.',
      errors: validation.errors
    });
  }

  try {
    const entry = {
      id: crypto.randomUUID(),
      ...validation.data,
      createdAt: new Date().toISOString(),
      userAgent: req.get('user-agent') || null
    };

    const emailResult = await sendContactEmail(entry);

    return res.status(201).json({
      success: true,
      message: /activation/i.test(emailResult.message || '')
        ? 'Form kontak sudah tersambung. Cek inbox email dan klik link aktivasi FormSubmit agar pesan berikutnya masuk normal.'
        : 'Pesan berhasil dikirim ke email. Terima kasih, saya akan mengeceknya secepat mungkin.',
      emailId: emailResult.id || null
    });
  } catch (error) {
    console.error('Gagal mengirim email kontak:', error.details || error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: 'Maaf, pesan belum bisa dikirim ke email. Coba lagi beberapa saat nanti.'
    });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint API tidak ditemukan.'
  });
});

app.use((error, req, res, next) => {
  console.error('Terjadi error di server:', error);

  res.status(500).json({
    success: false,
    message: 'Server sedang mengalami kendala.'
  });
});

function startServer(port, attempt = 0) {
  const server = app.listen(port, () => {
    console.log(`Website portofolio berjalan di http://localhost:${port}`);
  });

  server.on('error', (error) => {
    const canTryNextPort = error.code === 'EADDRINUSE' && !process.env.PORT && attempt < MAX_PORT_RETRIES;

    if (canTryNextPort) {
      const nextPort = port + 1;
      console.warn(`Port ${port} sedang dipakai, mencoba port ${nextPort}.`);
      startServer(nextPort, attempt + 1);
      return;
    }

    console.error('Server gagal dinyalakan:', error.message);
    process.exitCode = 1;
  });
}

module.exports = app;

if (require.main === module) {
  startServer(DEFAULT_PORT);
}