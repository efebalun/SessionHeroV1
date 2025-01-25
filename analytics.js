// Google Analytics 4 Implementation for Chrome Extension using Measurement Protocol
(function() {
    const GA_MEASUREMENT_ID = 'G-YD4HF9PYFC';
    const GA_API_SECRET = 'L6-ZQnvsTAK1ughh_A_sHw';
    const GA_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;

    // Create a unique client ID for the user
    function getOrCreateClientId() {
        let clientId = localStorage.getItem('ga_client_id');
        if (!clientId) {
            clientId = crypto.randomUUID();
            localStorage.setItem('ga_client_id', clientId);
        }
        return clientId;
    }

    // Get session ID
    function getOrCreateSessionId() {
        let sessionId = sessionStorage.getItem('ga_session_id');
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            sessionStorage.setItem('ga_session_id', sessionId);
        }
        return sessionId;
    }

    // Send event to GA4
    async function sendToGA4(name, params = {}) {
        try {
            const clientId = getOrCreateClientId();
            const sessionId = getOrCreateSessionId();

            const body = {
                client_id: clientId,
                events: [{
                    name,
                    params: {
                        session_id: sessionId,
                        engagement_time_msec: 100,
                        ...params
                    }
                }]
            };

            const response = await fetch(GA_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`GA4 request failed: ${response.status}`);
            }

            // Store event locally for backup
            const event = {
                name,
                params,
                timestamp: new Date().toISOString(),
                client_id: clientId,
                session_id: sessionId
            };

            chrome.storage.local.get('analytics', (data) => {
                const analytics = data.analytics || [];
                analytics.push(event);
                
                // Keep only last 1000 events
                if (analytics.length > 1000) {
                    analytics.shift();
                }
                
                chrome.storage.local.set({ analytics });
            });

        } catch (error) {
            console.error('Error sending event to GA4:', error);
        }
    }

    // Export tracking function
    window.trackEvent = function(category, action, params = {}) {
        sendToGA4(action, {
            event_category: category,
            ...params
        });
    };

    // Track initial pageview
    sendToGA4('page_view', {
        page_title: 'Session Hero Manager',
        page_location: 'chrome-extension://session-hero/manager.html'
    });
})(); 