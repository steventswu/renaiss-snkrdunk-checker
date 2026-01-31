// background.js
chrome.action.onClicked.addListener((tab) => {
    console.log("Action icon clicked on tab:", tab.id, tab.url);
    if (tab.url && tab.url.includes("renaiss.xyz")) {
        chrome.tabs.sendMessage(tab.id, { action: "toggleModal" }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Message failed (likely script not loaded):", chrome.runtime.lastError.message);
                // Fallback: Try to inject the script if it's not there? 
                // For now, just logging is enough to diagnose.
            } else {
                console.log("Toggle message sent successfully:", response);
            }
        });
    } else {
        console.log("Click ignored: Not on renaiss.xyz");
    }
});
