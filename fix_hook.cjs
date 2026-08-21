const fs = require('fs');
const files = [
    "src/VisaBookingFlowV3.tsx",
    "src/TransportBookingFlowV3.tsx",
    "src/TicketBookingFlowV2.tsx",
    "src/PackageBookingFlowV2.tsx",
    "src/HotelBookingFlowV3.tsx",
    "src/PackageBookingFlow.tsx",
    "src/MiscBookingFlowV3.tsx",
    "src/MiscBookingFlowV2.tsx"
];

files.forEach(file => {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace("useBookingFlowState(transactionType, entries,", "useBookingFlowState(companyId, transactionType, entries,");
    content = content.replace("function assignUb() {", "async function assignUb() {");
    content = content.replace("hookAssign(previewUb)", "await hookAssign(previewUb)");
    content = content.replace("assign(previewUb)", "await assign(previewUb)");
    fs.writeFileSync(file, content);
});
console.log("Done");
