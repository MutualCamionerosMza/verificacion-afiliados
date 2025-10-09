const allowedOrigins = [
  'https://evamendezs.github.io',
  'https://mutualcamionerosmza.github.io'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Postman o curl
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS no permitido para el origen: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-pin']
}));
