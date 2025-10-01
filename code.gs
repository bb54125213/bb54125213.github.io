function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    
    // 回答を保存するシートを取得（'シート1'の部分は実際のシート名に合わせてください）
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('シート1');

    const now = new Date();
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const rowData = headers.map(header => {
      if (header === 'timestamp') {
        return now;
      } else if (header === 'date') {
        return `${now.getFullYear()}/${('0' + (now.getMonth() + 1)).slice(-2)}/${('0' + now.getDate()).slice(-2)}`;
      } else {
        // スプレッドシートのヘッダー名と、HTMLのname属性を一致させる
        return params[header] || '';
      }
    });
    
    sheet.appendRow(rowData);
    
    return ContentService.createTextOutput(JSON.stringify({ 'result': 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'message': error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}