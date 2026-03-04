/**
 * AI Upskilling Hub -- Google Apps Script Backend
 *
 * Deploy as Web App (Execute as: Me, Access: Anyone within organization)
 * to serve as a shared backend for ratings, wish list, and upvotes.
 *
 * SETUP:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into Code.gs
 * 3. Run setupSheet() once from the editor (Run > setupSheet)
 *    -- this creates the Google Sheet with all required tabs
 * 4. Deploy > New deployment > Web app
 *    -- Execute as: Me
 *    -- Who has access: Anyone (or "Anyone within Red Hat" if org-restricted)
 * 5. Copy the Web App URL and paste it into ai-upskilling.html (API_URL constant)
 *
 * The Sheet URL will appear in the execution log after running setupSheet().
 */

// ── Sheet Setup ──────────────────────────────────────────────────────────────

function setupSheet() {
  const ss = SpreadsheetApp.create('AI Upskilling Hub - Data');

  const ratings = ss.getSheets()[0];
  ratings.setName('Ratings');
  ratings.getRange('A1:D1').setValues([['cardId', 'visitorId', 'rating', 'timestamp']]);
  ratings.setFrozenRows(1);

  const wishes = ss.insertSheet('Wishes');
  wishes.getRange('A1:E1').setValues([['wishId', 'text', 'date', 'createdBy', 'timestamp']]);
  wishes.setFrozenRows(1);

  const wishVotes = ss.insertSheet('WishVotes');
  wishVotes.getRange('A1:C1').setValues([['wishId', 'visitorId', 'timestamp']]);
  wishVotes.setFrozenRows(1);

  const upvotes = ss.insertSheet('Upvotes');
  upvotes.getRange('A1:C1').setValues([['topicId', 'visitorId', 'timestamp']]);
  upvotes.setFrozenRows(1);

  Logger.log('Sheet created: ' + ss.getUrl());
  Logger.log('Sheet ID: ' + ss.getId());

  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return SpreadsheetApp.openById(id);
}

function jsonResponse(data, callback) {
  var json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(sheet) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ── GET: Load All Data ───────────────────────────────────────────────────────

function doGet(e) {
  var callback = (e.parameter && e.parameter.callback) || '';
  try {
    const visitorId = (e.parameter && e.parameter.visitorId) || '';
    const ss = getSheet();

    const ratingsData = getSheetData(ss.getSheetByName('Ratings'));
    const wishesData = getSheetData(ss.getSheetByName('Wishes'));
    const wishVotesData = getSheetData(ss.getSheetByName('WishVotes'));
    const upvotesData = getSheetData(ss.getSheetByName('Upvotes'));

    const ratings = {};
    ratingsData.forEach(r => {
      if (!ratings[r.cardId]) ratings[r.cardId] = { sum: 0, count: 0, userRating: 0 };
      ratings[r.cardId].sum += Number(r.rating);
      ratings[r.cardId].count++;
      if (r.visitorId === visitorId) ratings[r.cardId].userRating = Number(r.rating);
    });

    const wishVoteCounts = {};
    const myWishVotes = [];
    wishVotesData.forEach(wv => {
      wishVoteCounts[wv.wishId] = (wishVoteCounts[wv.wishId] || 0) + 1;
      if (wv.visitorId === visitorId) myWishVotes.push(wv.wishId);
    });

    const wishes = wishesData.map(w => ({
      id: w.wishId,
      text: w.text,
      date: w.date,
      votes: wishVoteCounts[w.wishId] || 0
    }));

    const upvoteCounts = {};
    const myUpvotes = [];
    upvotesData.forEach(u => {
      upvoteCounts[u.topicId] = (upvoteCounts[u.topicId] || 0) + 1;
      if (u.visitorId === visitorId) myUpvotes.push(u.topicId);
    });

    return jsonResponse({
      ok: true,
      ratings: ratings,
      wishes: wishes,
      wishVoted: myWishVotes,
      upvotes: upvoteCounts,
      votedTopics: myUpvotes
    }, callback);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, callback);
  }
}

// ── POST: Handle Actions ─────────────────────────────────────────────────────

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const visitorId = body.visitorId || '';
    const ss = getSheet();
    const now = new Date().toISOString();

    switch (action) {

      case 'rate': {
        const sheet = ss.getSheetByName('Ratings');
        const data = sheet.getDataRange().getValues();
        let found = false;
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] === body.cardId && data[i][1] === visitorId) {
            sheet.getRange(i + 1, 3).setValue(body.rating);
            sheet.getRange(i + 1, 4).setValue(now);
            found = true;
            break;
          }
        }
        if (!found) {
          sheet.appendRow([body.cardId, visitorId, body.rating, now]);
        }
        return jsonResponse({ ok: true });
      }

      case 'addWish': {
        const sheet = ss.getSheetByName('Wishes');
        const wishId = 'w-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
        const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        sheet.appendRow([wishId, body.text, date, visitorId, now]);
        return jsonResponse({ ok: true, wishId: wishId, date: date });
      }

      case 'voteWish': {
        const sheet = ss.getSheetByName('WishVotes');
        const data = sheet.getDataRange().getValues();
        let rowIdx = -1;
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] === body.wishId && data[i][1] === visitorId) {
            rowIdx = i + 1;
            break;
          }
        }
        if (rowIdx > 0) {
          sheet.deleteRow(rowIdx);
          return jsonResponse({ ok: true, toggled: 'removed' });
        } else {
          sheet.appendRow([body.wishId, visitorId, now]);
          return jsonResponse({ ok: true, toggled: 'added' });
        }
      }

      case 'deleteWish': {
        const wishSheet = ss.getSheetByName('Wishes');
        const wishData = wishSheet.getDataRange().getValues();
        for (let i = wishData.length - 1; i >= 1; i--) {
          if (wishData[i][0] === body.wishId) {
            wishSheet.deleteRow(i + 1);
            break;
          }
        }
        const voteSheet = ss.getSheetByName('WishVotes');
        const voteData = voteSheet.getDataRange().getValues();
        for (let i = voteData.length - 1; i >= 1; i--) {
          if (voteData[i][0] === body.wishId) {
            voteSheet.deleteRow(i + 1);
          }
        }
        return jsonResponse({ ok: true });
      }

      case 'upvote': {
        const sheet = ss.getSheetByName('Upvotes');
        const data = sheet.getDataRange().getValues();
        let rowIdx = -1;
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] === body.topicId && data[i][1] === visitorId) {
            rowIdx = i + 1;
            break;
          }
        }
        if (rowIdx > 0) {
          sheet.deleteRow(rowIdx);
          return jsonResponse({ ok: true, toggled: 'removed' });
        } else {
          sheet.appendRow([body.topicId, visitorId, now]);
          return jsonResponse({ ok: true, toggled: 'added' });
        }
      }

      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}
