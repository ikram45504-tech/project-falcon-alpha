const fs = require('fs');

const files = [
  'src/HotelBookingFlowV3.tsx',
  'src/MiscBookingFlowV3.tsx',
  'src/TicketBookingFlowV2.tsx',
  'src/TransportBookingFlowV3.tsx',
  'src/VisaBookingFlowV3.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  // replace exact string
  content = content.replace('function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }\n', '');
  content = content.replace('function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }\r\n', '');

  fs.writeFileSync(file, content);
}
console.log("Fixed");
