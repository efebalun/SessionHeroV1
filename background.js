// Handle toolbar icon click
chrome.action.onClicked.addListener(async () => {
    // Check if manager tab already exists
    const tabs = await chrome.tabs.query({});
    const managerTab = tabs.find(tab => tab.url?.includes('manager.html'));
    
    if (managerTab) {
        // Focus existing tab
        await chrome.tabs.update(managerTab.id, { active: true });
        await chrome.windows.update(managerTab.windowId, { focused: true });
    } else {
        // Create new tab
        await chrome.tabs.create({
            url: 'manager.html'
        });
    }
});

// Listen for messages from the manager page
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === "saveTabs") {
        const windows = await chrome.windows.getAll({ populate: true });
        const sessionData = [];

        // Process each window
        for (const window of windows) {
            // Get tab groups for this window
            const tabGroups = await chrome.tabGroups.query({ windowId: window.id });
            
            // Save window data with tabs and their group information
            sessionData.push({
                tabs: window.tabs.map(tab => ({
                    url: tab.url,
                    title: tab.title,
                    groupId: tab.groupId,
                    active: tab.active,
                    pinned: tab.pinned,
                    index: tab.index
                })),
                tabGroups: tabGroups.map(group => ({
                    id: group.id,
                    title: group.title,
                    color: group.color,
                    collapsed: group.collapsed
                }))
            });
        }

        const session = {
            name: request.sessionName,
            date: new Date().toISOString(),
            windows: sessionData
        };

        // Use the provided sessionId or generate a new one
        const key = request.sessionId || `session_${Date.now()}`;
        await chrome.storage.local.set({ [key]: session });
    } else if (request.action === "restoreSession") {
        const data = await chrome.storage.local.get(request.sessionId);
        const session = data[request.sessionId];

        if (!session) return;

        for (const windowData of session.windows) {
            // Create a new window
            const window = await chrome.windows.create({
                focused: true,
                state: 'normal'
            });

            // Create all tabs first
            const tabPromises = windowData.tabs.map(tab =>
                chrome.tabs.create({
                    windowId: window.id,
                    url: tab.url,
                    pinned: tab.pinned || false,
                    active: false
                })
            );

            const createdTabs = await Promise.all(tabPromises);

            // Map the tabs to their groups
            const tabMappings = new Map();
            windowData.tabs.forEach((originalTab, index) => {
                if (originalTab.groupId !== -1) {
                    if (!tabMappings.has(originalTab.groupId)) {
                        tabMappings.set(originalTab.groupId, []);
                    }
                    if (createdTabs[index]) {
                        tabMappings.get(originalTab.groupId).push(createdTabs[index].id);
                    }
                }
            });

            // Create tab groups
            if (windowData.tabGroups) {
                for (const group of windowData.tabGroups) {
                    const tabIds = tabMappings.get(group.id);
                    if (tabIds && tabIds.length > 0) {
                        try {
                            // First create the group
                            const newGroupId = await chrome.tabs.group({
                                tabIds,
                                createProperties: { windowId: window.id }
                            });

                            // Then update its properties
                            await chrome.tabGroups.update(newGroupId, {
                                title: group.title,
                                color: group.color,
                                collapsed: group.collapsed
                            });
                        } catch (error) {
                            console.error('Error creating tab group:', error);
                        }
                    }
                }
            }

            // Finally, maximize the window
            await chrome.windows.update(window.id, { state: 'maximized' });
        }
    }
}); 