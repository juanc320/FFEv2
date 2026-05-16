const fs = require('fs');
const b = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64');
fs.writeFileSync('public/icons/icon-192.png', b);
fs.writeFileSync('public/icons/icon-512.png', b);
