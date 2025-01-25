// React
const e = React.createElement;

// Constants
const APP_NAME = 'Session Hero';
const APP_VERSION = '0.0.1';
const APP_ICON = './icons/icon128.png';

// Helper function for tracking events
function trackEvent(eventName, eventParams = {}) {
    try {
        // Track in Google Analytics 4
        window.trackEvent('Session Hero', eventName, {
            ...eventParams,
            client_type: 'extension',
            app_version: APP_VERSION
        });
    } catch (error) {
        console.error('Error tracking event:', error);
    }
}

// Add dark mode detection
function setupDarkMode() {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function updateDarkMode(e) {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }

    // Set initial value
    updateDarkMode(darkModeMediaQuery);

    // Listen for changes
    darkModeMediaQuery.addEventListener('change', updateDarkMode);
}

// Call it when the script loads
setupDarkMode();

function App() {
    const [sessions, setSessions] = React.useState([]);
    const [currentTabs, setCurrentTabs] = React.useState({ windows: [], totalTabs: 0 });
    const [activeSessionId, setActiveSessionId] = React.useState('current');
    const [searchQuery, setSearchQuery] = React.useState('');
    const [isSaving, setIsSaving] = React.useState(false);

    // Add theme state
    const [theme, setTheme] = React.useState(() => {
        const savedTheme = localStorage.getItem('theme');
        return savedTheme || 'system';
    });

    // Initialize theme on mount
    React.useEffect(() => {
        const savedTheme = localStorage.getItem('theme') || 'system';
        handleThemeChange(savedTheme);
    }, []);

    // Update theme handler
    function handleThemeChange(newTheme) {
        // Track theme change
        trackEvent('change_theme', {
            theme: newTheme
        });

        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);

        if (newTheme === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', newTheme);
        }
    }

    // Update setupDarkMode to respect the theme setting
    React.useEffect(() => {
        const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        function updateDarkMode(e) {
            if (theme === 'system') {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            }
        }

        if (theme === 'system') {
            updateDarkMode(darkModeMediaQuery);
            darkModeMediaQuery.addEventListener('change', updateDarkMode);
        }

        return () => darkModeMediaQuery.removeEventListener('change', updateDarkMode);
    }, [theme]);

    React.useEffect(() => {
        loadSessions();
        loadCurrentTabs();
    }, []);

    async function loadSessions() {
        const data = await chrome.storage.local.get(null);
        const sessionsList = Object.entries(data)
            .filter(([key]) => key.startsWith('session_'))
            .map(([id, session]) => ({
                id,
                name: session.name,
                date: session.date,
                windows: session.windows,
                totalTabs: session.windows.reduce((count, w) => count + w.tabs.length, 0)
            }))
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        setSessions(sessionsList);
    }

    async function loadCurrentTabs() {
        const windows = await chrome.windows.getAll({ populate: true });
        const totalTabs = windows.reduce((count, window) => count + window.tabs.length, 0);

        // Fetch tab groups for each window
        const windowsWithGroups = await Promise.all(windows.map(async window => {
            const tabGroups = await chrome.tabGroups.query({ windowId: window.id });
            return {
                ...window,
                tabGroups
            };
        }));

        setCurrentTabs({
            windows: windowsWithGroups,
            totalTabs
        });
    }

    async function handleSaveSession(name) {
        if (!name.trim() || isSaving) return;

        try {
            setIsSaving(true);
            const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Track save session event
            trackEvent('save_session', {
                session_name: name
            });

            await chrome.runtime.sendMessage({
                action: 'saveTabs',
                sessionName: name,
                sessionId: sessionId
            });

            // Wait for the save to complete
            await new Promise(resolve => setTimeout(resolve, 200));
            await loadSessions();
        } catch (error) {
            console.error('Error saving session:', error);
        } finally {
            setIsSaving(false);
        }
    }

    async function handleDeleteSession(sessionId) {
        if (!confirm('Delete this session?')) return;

        // Track delete session event
        trackEvent('delete_session');

        await chrome.storage.local.remove(sessionId);
        await loadSessions();
        if (activeSessionId === sessionId) {
            setActiveSessionId('current');
        }
    }

    async function handleDeleteItem(sessionId, type, windowIndex, itemTitle) {
        if (!confirm(`Delete this ${type}?`)) return;

        const data = await chrome.storage.local.get(sessionId);
        const session = data[sessionId];
        const window = session.windows[windowIndex];

        if (type === 'window') {
            session.windows.splice(windowIndex, 1);
        } else if (type === 'tab-group') {
            window.tabGroups = window.tabGroups.filter(g => g.title !== itemTitle);
            window.tabs = window.tabs.filter(t => t.groupId === -1 ||
                window.tabGroups.some(g => g.id === t.groupId));
        } else if (type === 'tab') {
            window.tabs = window.tabs.filter(t => t.title !== itemTitle);
        }

        await chrome.storage.local.set({ [sessionId]: session });
        await loadSessions();
    }

    async function handleCloneSession(sessionId) {
        const data = await chrome.storage.local.get(sessionId);
        const session = data[sessionId];

        // Track clone session event
        trackEvent('clone_session');

        const newSession = {
            ...session,
            name: `${session.name} (Copy)`,
            date: new Date().toISOString()
        };
        const newSessionId = `session_${Date.now()}`;
        await chrome.storage.local.set({ [newSessionId]: newSession });
        await loadSessions();
    }

    async function handleSortSession(sessionId, sortBy) {
        const data = await chrome.storage.local.get(sessionId);
        const session = data[sessionId];

        // Track sort event
        trackEvent('sort_session', {
            sort_by: sortBy,
            tab_count: session.windows.reduce((sum, window) => sum + window.tabs.length, 0)
        });

        session.windows.forEach(window => {
            window.tabs.sort((a, b) => {
                const valueA = sortBy === 'title' ? a.title : a.url;
                const valueB = sortBy === 'title' ? b.title : b.url;
                return valueA.localeCompare(valueB);
            });
        });

        await chrome.storage.local.set({ [sessionId]: session });
        await loadSessions();
    }

    async function handleRenameSession(sessionId, currentName) {
        const newName = prompt('Enter new session name:', currentName);
        if (!newName || newName.trim() === '' || newName === currentName) return;

        try {
            const data = await chrome.storage.local.get(sessionId);
            const session = data[sessionId];

            // Track rename event
            trackEvent('rename_session', {
                old_name: currentName,
                new_name: newName
            });

            session.name = newName.trim();
            await chrome.storage.local.set({ [sessionId]: session });
            await loadSessions();
        } catch (error) {
            console.error('Error renaming session:', error);
        }
    }

    // Helper function to highlight text
    function highlightText(text, query) {
        if (!query) return text;

        const parts = text.split(new RegExp(`(${query})`, 'gi'));
        return e('span', null,
            parts.map((part, i) =>
                part.toLowerCase() === query.toLowerCase()
                    ? e('span', {
                        key: i,
                        style: {
                            backgroundColor: 'var(--primary-color-light)',
                            color: 'var(--primary-color)',
                            borderRadius: '2px',
                            padding: '0 2px'
                        }
                    }, part)
                    : part
            )
        );
    }

    function SessionActions({ session }) {
        const [isOpen, setIsOpen] = React.useState(false);
        const dropdownRef = React.useRef(null);

        React.useEffect(() => {
            function handleClickOutside(event) {
                if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                    setIsOpen(false);
                }
            }
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }, []);

        async function handleOpen() {
            const data = await chrome.storage.local.get(session.id);
            const sessionData = data[session.id];

            // Calculate total tabs and groups across all windows
            const totalTabs = sessionData.windows.reduce((sum, window) => sum + window.tabs.length, 0);
            const totalGroups = sessionData.windows.reduce((sum, window) => sum + (window.tabGroups?.length || 0), 0);

            // Track session open event
            trackEvent('open_session', {
                total_tabs: totalTabs,
                total_groups: totalGroups,
                window_count: sessionData.windows.length,
                session_name: sessionData.name
            });

            // Build confirmation message
            let confirmMessage = `Open ${sessionData.windows.length} windows with:\n`;
            if (totalTabs > 0) confirmMessage += `• ${totalTabs} tabs\n`;
            if (totalGroups > 0) confirmMessage += `• ${totalGroups} tab groups\n`;
            confirmMessage += `\nAre you sure?`;

            if (!confirm(confirmMessage)) return;

            // Process each window separately
            for (const windowData of sessionData.windows) {
                try {
                    // Create a new window without any tabs
                    const newWindow = await chrome.windows.create({
                        focused: true,
                        state: 'normal',
                        url: [] // Empty array means no tabs will be created
                    });

                    // Store the window ID
                    const windowId = newWindow.id;

                    // Add a small delay after window creation
                    await new Promise(resolve => setTimeout(resolve, 200));

                    // Verify window exists and get fresh window object
                    const freshWindow = await chrome.windows.get(windowId).catch(() => null);
                    if (!freshWindow) {
                        console.error('Window was closed before initialization');
                        continue;
                    }

                    // Create all tabs first
                    const tabPromises = windowData.tabs.map(tab =>
                        chrome.tabs.create({
                            windowId,
                            url: tab.url,
                            pinned: tab.pinned || false,
                            active: false
                        })
                    );

                    // Wait for all tabs to be created
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
                    if (windowData.tabGroups && createdTabs.length > 0) {
                        for (const group of windowData.tabGroups) {
                            const tabIds = tabMappings.get(group.id);
                            if (tabIds && tabIds.length > 0) {
                                try {
                                    const newGroupId = await chrome.tabs.group({
                                        tabIds,
                                        createProperties: { windowId }
                                    });

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

                    // Finally, maximize the window and ensure it's focused
                    await chrome.windows.update(windowId, {
                        state: 'maximized',
                        focused: true
                    });

                } catch (error) {
                    console.error('Error processing window:', error);
                    continue;
                }
            }
        }

        return e('div', { className: 'action-buttons' },
            e('button', {
                className: 'button',
                onClick: handleOpen
            },
                renderIcon('open-all'),
                'Open all'
            ),
            e('div', {
                className: 'actions-dropdown',
                ref: dropdownRef
            },
                e('button', {
                    className: 'button button-variant-plain button-fw',
                    onClick: () => setIsOpen(!isOpen)
                },
                    renderIcon('dots')
                ),
                e('div', {
                    className: `dropdown-content ${isOpen ? 'show' : ''}`
                },
                    e('div', { className: 'dropdown-group' },
                        e('div', { className: 'dropdown-group-title' }, 'Sort'),
                        e('div', {
                            className: 'dropdown-item',
                            onClick: () => handleSortSession(session.id, 'title')
                        }, 'Sort by title'),
                        e('div', {
                            className: 'dropdown-item',
                            onClick: () => handleSortSession(session.id, 'url')
                        }, 'Sort by URL'),
                    ),
                    e('div', { className: 'dropdown-divider' }),
                    e('div', { className: 'dropdown-group' },
                        e('div', { className: 'dropdown-group-title' }, 'Actions'),
                        e('div', {
                            className: 'dropdown-item',
                            onClick: () => {
                                setIsOpen(false);
                                handleRenameSession(session.id, session.name);
                            }
                        }, 'Rename'),
                        e('div', {
                            className: 'dropdown-item',
                            onClick: () => handleCloneSession(session.id)
                        }, 'Clone'),
                        e('div', {
                            className: 'dropdown-item',
                            onClick: () => {
                                setIsOpen(false);
                                handleDeleteSession(session.id);
                            }
                        }, 'Delete')
                    ),
                )
            )
        );
    }

    // Icon functions

    // Add new helper functions for handling clicks
    async function handleTreeItemClick(type, data, isCurrentSession = false) {
        try {
            // Track click event
            trackEvent('click_item', {
                item_type: type,
                is_current_session: isCurrentSession,
                has_url: !!data.url
            });

            // Handle current session items differently
            if (isCurrentSession) {
                switch (type) {
                    case 'window':
                        // Focus the existing window
                        await chrome.windows.update(data.id, {
                            focused: true,
                            state: 'maximized'
                        });
                        break;

                    case 'tab-group':
                        // Focus the first tab in the group
                        const groupTabs = data.tabs || [];
                        if (groupTabs.length > 0) {
                            await chrome.tabs.update(groupTabs[0].id, { active: true });
                            await chrome.windows.update(groupTabs[0].windowId, { focused: true });
                        }
                        break;

                    case 'tab':
                        // Focus the existing tab
                        await chrome.tabs.update(data.id, { active: true });
                        await chrome.windows.update(data.windowId, { focused: true });
                        break;
                }
                return;
            }

            // Handle saved session items with existing open behavior
            switch (type) {
                case 'window':
                    // Show confirmation with window details
                    const tabCount = data.tabs.length;
                    const groupCount = data.tabGroups?.length || 0;

                    // Track window open event
                    trackEvent('open_window', {
                        tab_count: tabCount,
                        group_count: groupCount,
                        is_current_session: isCurrentSession
                    });

                    let windowConfirmMessage = `Open a new window with:\n`;
                    if (tabCount > 0) windowConfirmMessage += `• ${tabCount} tabs\n`;
                    if (groupCount > 0) windowConfirmMessage += `• ${groupCount} tab groups\n`;
                    windowConfirmMessage += `\nAre you sure?`;

                    if (!confirm(windowConfirmMessage)) return;

                    // Rest of existing window creation code...
                    const newWindow = await chrome.windows.create({
                        focused: true,
                        state: 'normal',
                        url: []
                    });

                    const tabPromises = data.tabs.map(tab =>
                        chrome.tabs.create({
                            windowId: newWindow.id,
                            url: tab.url,
                            pinned: tab.pinned || false,
                            active: false
                        })
                    );

                    const createdTabs = await Promise.all(tabPromises);

                    if (data.tabGroups) {
                        const tabMappings = new Map();
                        data.tabs.forEach((originalTab, index) => {
                            if (originalTab.groupId !== -1 && createdTabs[index]) {
                                if (!tabMappings.has(originalTab.groupId)) {
                                    tabMappings.set(originalTab.groupId, []);
                                }
                                tabMappings.get(originalTab.groupId).push(createdTabs[index].id);
                            }
                        });

                        for (const group of data.tabGroups) {
                            const tabIds = tabMappings.get(group.id);
                            if (tabIds && tabIds.length > 0) {
                                const newGroupId = await chrome.tabs.group({
                                    tabIds,
                                    createProperties: { windowId: newWindow.id }
                                });
                                await chrome.tabGroups.update(newGroupId, {
                                    title: group.title,
                                    color: group.color,
                                    collapsed: group.collapsed
                                });
                            }
                        }
                    }

                    await chrome.windows.update(newWindow.id, { state: 'maximized' });
                    break;

                case 'tab-group':
                    // Show confirmation with group details
                    const groupTabCount = data.tabs.length;
                    if (groupTabCount === 0) return;

                    // Track tab group open event
                    trackEvent('open_tab_group', {
                        tab_count: groupTabCount,
                        group_title: data.title,
                        group_color: data.color,
                        is_current_session: isCurrentSession
                    });

                    const groupConfirmMessage = `Open tab group "${data.title}" with ${groupTabCount} tabs?\n`;

                    if (!confirm(groupConfirmMessage)) return;

                    // Get the currently focused window
                    const groupWindows = await chrome.windows.getAll({
                        windowTypes: ['normal'],
                        populate: true
                    });
                    const focusedGroupWindow = groupWindows.find(w => w.focused);

                    if (focusedGroupWindow) {
                        // Create tabs for the group in the focused window
                        const groupTabPromises = data.tabs.map(tab =>
                            chrome.tabs.create({
                                windowId: focusedGroupWindow.id,
                                url: tab.url,
                                pinned: tab.pinned || false,
                                active: false
                            })
                        );

                        const groupTabs = await Promise.all(groupTabPromises);
                        const tabIds = groupTabs.map(tab => tab.id);

                        // Create the group
                        const groupId = await chrome.tabs.group({
                            tabIds,
                            createProperties: { windowId: focusedGroupWindow.id }
                        });

                        await chrome.tabGroups.update(groupId, {
                            title: data.title,
                            color: data.color,
                            collapsed: data.collapsed
                        });
                    } else {
                        // If no window is focused, create tabs in the current window
                        const groupTabPromises = data.tabs.map(tab =>
                            chrome.tabs.create({
                                url: tab.url,
                                pinned: tab.pinned || false,
                                active: false
                            })
                        );

                        const groupTabs = await Promise.all(groupTabPromises);
                        const tabIds = groupTabs.map(tab => tab.id);

                        // Create the group
                        const groupId = await chrome.tabs.group({
                            tabIds
                        });

                        await chrome.tabGroups.update(groupId, {
                            title: data.title,
                            color: data.color,
                            collapsed: data.collapsed
                        });
                    }
                    break;

                case 'tab':
                    // Track single tab open event
                    trackEvent('open_tab', {
                        has_favicon: !!data.favIconUrl,
                        is_pinned: !!data.pinned,
                        is_current_session: isCurrentSession
                    });

                    // Get the currently focused window
                    const currentWindows = await chrome.windows.getAll({
                        windowTypes: ['normal'],
                        populate: true
                    });
                    const currentWindow = currentWindows.find(w => w.focused);

                    if (currentWindow) {
                        // Open in currently focused window
                        await chrome.tabs.create({
                            windowId: currentWindow.id,
                            url: data.url,
                            active: true
                        });
                    } else {
                        // If no window is focused, create a new tab in the current window
                        await chrome.tabs.create({
                            url: data.url,
                            active: true
                        });
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling tree item click:', error);
        }
    }
    function renderIcon(icon) {
        switch (icon) {
            case 'logo':
                return e('svg', { width: '128', height: '128', viewBox: '0 0 128 128', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
                    e('g', { 'clip-path': 'url(#clip0_11_44)' },
                        e('rect', { width: '128', height: '128', rx: '50', fill: '#FF6A00' }),
                        e('path', {
                            'fill-rule': 'evenodd',
                            'clip-rule': 'evenodd',
                            d: 'M30 54C27.2386 54 25 56.2386 25 59V69C25 77.2843 18.2843 84 10 84H0V74H10C12.7614 74 15 71.7614 15 69V59C15 50.7157 21.7157 44 30 44H53C61.2843 44 68 50.7157 68 59V69C68 71.7614 70.2386 74 73 74H128V84H73C64.7157 84 58 77.2843 58 69V59C58 56.2386 55.7614 54 53 54H30Z',
                            fill: 'white'
                        }),
                        e('path', {
                            'fill-rule': 'evenodd',
                            'clip-rule': 'evenodd',
                            d: 'M73 54C70.2386 54 68 56.2386 68 59V69H58V59C58 50.7157 64.7157 44 73 44H96C104.284 44 111 50.7157 111 59V69C111 71.7614 113.239 74 116 74H128V84H116C107.716 84 101 77.2843 101 69V59C101 56.2386 98.7614 54 96 54H73Z',
                            fill: 'white',
                            'fill-opacity': '0.5'
                        })
                    ),
                    e('defs', {},
                        e('clipPath', { id: 'clip0_11_44' },
                            e('rect', { width: '128', height: '128', fill: 'white' })
                        )
                    )
                );
            case 'x':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon",
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M18 6l-12 12" }),
                    e('path', { d: "M6 6l12 12" })
                );
            case 'dots':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon"
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" }),
                    e('path', { d: "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" }),
                    e('path', { d: "M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" })
                );
            case 'list':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon"
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M9 6l11 0" }),
                    e('path', { d: "M9 12l11 0" }),
                    e('path', { d: "M9 18l11 0" }),
                    e('path', { d: "M5 6l0 .01" }),
                    e('path', { d: "M5 12l0 .01" }),
                    e('path', { d: "M5 18l0 .01" })
                );
            case 'window':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon"
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" }),
                    e('path', { d: "M6 8h.01" }),
                    e('path', { d: "M9 8h.01" })
                );
            case 'tab-group':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon"
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M16.52 7h-10.52a2 2 0 0 0 -2 2v6a2 2 0 0 0 2 2h10.52a1 1 0 0 0 .78 -.375l3.7 -4.625l-3.7 -4.625a1 1 0 0 0 -.78 -.375" })
                );
            case 'url':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon"
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" }),
                    e('path', { d: "M3.6 9h16.8" }),
                    e('path', { d: "M3.6 15h16.8" }),
                    e('path', { d: "M11.5 3a17 17 0 0 0 0 18" }),
                    e('path', { d: "M12.5 3a17 17 0 0 1 0 18" })
                );
            case 'open-all':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon"
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" }),
                    e('path', { d: "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" })
                );
            case 'settings':
                return e('svg', {
                    width: "24",
                    height: "24",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    className: "icon"
                },
                    e('path', { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
                    e('path', { d: "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" }),
                    e('path', { d: "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" }),
                );
            default:
                return null;
        }
    }

    // Update renderTreeItem function
    function renderTreeItem({ type, icon, title, meta, includeDelete, onDelete, children, data, isCurrentSession }) {
        return e('div', { className: `tree-item ${type}` },
            e('div', {
                className: 'tree-content',
                onClick: (e) => {
                    // Don't trigger click if clicking delete button
                    if (e.target.closest('.delete-btn')) return;
                    handleTreeItemClick(type, data, isCurrentSession);
                }
            },
                e('span', { className: 'tree-content-main' },
                    e('span', { className: 'iconContainer' }, icon),
                    e('span', { className: 'title' },
                        typeof title === 'string' ? highlightText(title, searchQuery) : title
                    ),
                    meta && e('span', { className: 'meta' }, meta),
                ),
                e('span', { className: 'tree-content-actions' },
                    includeDelete && e('button', {
                        className: 'delete-btn',
                        onClick: onDelete
                    },
                        renderIcon('x'),
                    ),
                ),
            ),
            children && e('div', { className: 'tree-children' }, children)
        );
    }

    // Add prettyDate utility function
    function prettyDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = (now - date) / 1000; // Convert to seconds

        // Today's date at midnight for day comparison
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const inputDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));

        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (daysDiff === 0) return 'today';
        if (daysDiff === 1) return 'yesterday';
        if (daysDiff < 7) return `${daysDiff} days ago`;
        if (daysDiff < 30) return `${Math.floor(daysDiff / 7)} weeks ago`;
        if (daysDiff < 365) return `${Math.floor(daysDiff / 30)} months ago`;
        return `${Math.floor(daysDiff / 365)} years ago`;
    }

    function renderSidebar() {
        const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
        const settingsDropdownRef = React.useRef(null);

        React.useEffect(() => {
            function handleClickOutside(event) {
                if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(event.target)) {
                    setIsSettingsOpen(false);
                }
            }
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }, []);

        async function handleExport() {
            const data = await chrome.storage.local.get(null);
            const sessions = Object.entries(data)
                .filter(([key]) => key.startsWith('session_'))
                .reduce((acc, [key, value]) => {
                    acc[key] = value;
                    return acc;
                }, {});

            // Track export event
            trackEvent('export_sessions', {
                session_count: Object.keys(sessions).length
            });

            const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `session-hero-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setIsSettingsOpen(false);
        }

        async function handleImport() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const sessions = JSON.parse(text);

                    // Validate the imported data
                    if (typeof sessions !== 'object') throw new Error('Invalid format');

                    // Track import event
                    trackEvent('import_sessions', {
                        session_count: Object.keys(sessions).length
                    });

                    // Import each session
                    await Promise.all(
                        Object.entries(sessions).map(async ([key, session]) => {
                            if (!key.startsWith('session_')) return;
                            await chrome.storage.local.set({ [key]: session });
                        })
                    );

                    await loadSessions();
                    alert('Sessions imported successfully!');
                } catch (error) {
                    console.error('Import error:', error);
                    alert('Error importing sessions. Please check the file format.');
                }
            };

            input.click();
            setIsSettingsOpen(false);
        }

        return e('div', { className: 'sidebar' },
            e('div', { className: 'sidebar-header' },
                e('div', { className: 'logo' },
                    renderIcon('logo'),
                    e('span', { className: 'title' }, APP_NAME),
                    e('span', { className: 'version' }, APP_VERSION)
                ),
                e('div', {
                    className: 'actions-dropdown',
                    ref: settingsDropdownRef
                },
                    e('button', {
                        className: 'button button-variant-plain button-fw',
                        onClick: () => setIsSettingsOpen(!isSettingsOpen)
                    },
                        renderIcon('settings'),
                    ),
                    e('div', {
                        className: `dropdown-content ${isSettingsOpen ? 'show' : ''}`
                    },
                        // Backup Sessions group
                        e('div', { className: 'dropdown-group' },
                            e('div', { className: 'dropdown-group-title' }, 'Backup Sessions'),
                            e('div', {
                                className: 'dropdown-item',
                                onClick: handleExport
                            }, 'Export'),
                            e('div', {
                                className: 'dropdown-item',
                                onClick: handleImport
                            }, 'Import')
                        ),
                        e('div', { className: 'dropdown-divider' }),
                        // Color Schema group
                        e('div', { className: 'dropdown-group' },
                            e('div', { className: 'dropdown-group-title' }, 'Color Schema'),
                            e('div', {
                                className: `dropdown-item ${theme === 'light' ? 'active' : ''}`,
                                onClick: () => handleThemeChange('light')
                            }, 'Light mode'),
                            e('div', {
                                className: `dropdown-item ${theme === 'dark' ? 'active' : ''}`,
                                onClick: () => handleThemeChange('dark')
                            }, 'Dark mode'),
                            e('div', {
                                className: `dropdown-item ${theme === 'system' ? 'active' : ''}`,
                                onClick: () => handleThemeChange('system')
                            }, 'System')
                        )
                    )
                )
            ),
            e('div', { className: 'sidebar-sections' },
                e('section', null,
                    e('h3', null, 'CURRENT'),
                    e('div', { className: 'sidebar-items' },
                        e('div', {
                            className: `sidebar-item ${activeSessionId === 'current' ? 'active' : ''}`,
                            onClick: () => setActiveSessionId('current')
                        },
                            e('span', { className: 'content' },
                                e('span', { className: 'nameContainer' },
                                    e('span', { className: 'name' }, 'This browser'),
                                    e('span', null, ' '),
                                    e('span', { className: 'count' }, `${currentTabs.totalTabs} tabs`)
                                )
                            )
                        )
                    )
                ),
                sessions.length > 0 && e('section', null,
                    e('h3', null, 'SAVED SESSIONS'),
                    e('div', { className: 'sidebar-items' },
                        sessions.map(session =>
                            e('div', {
                                key: session.id,
                                className: `sidebar-item ${activeSessionId === session.id ? 'active' : ''}`,
                                onClick: () => setActiveSessionId(session.id)
                            },
                                e('span', { className: 'content' },
                                    e('span', { className: 'nameContainer' },
                                        e('span', { className: 'name' }, session.name),
                                        e('span', null, ' '),
                                        e('span', { className: 'count' }, `${session.totalTabs} tabs`)
                                    ),
                                    e('span', { className: 'date' }, prettyDate(session.date))
                                ),
                                e('button', {
                                    className: 'delete-btn',
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        handleDeleteSession(session.id);
                                    }
                                },
                                    renderIcon('x')
                                )
                            )
                        )
                    )
                ),
            ),
        );
    }

    function renderWindows(windows, isCurrentSession = false) {
        return windows.map((window, windowIndex) => {
            // Group tabs by their groupId
            const groupedTabs = {};
            const ungroupedTabs = [];

            window.tabs.forEach(tab => {
                if (tab.groupId === -1) {
                    ungroupedTabs.push(tab);
                } else {
                    if (!groupedTabs[tab.groupId]) {
                        groupedTabs[tab.groupId] = [];
                    }
                    groupedTabs[tab.groupId].push(tab);
                }
            });

            const shouldShow = searchQuery ?
                window.tabs.some(tab =>
                    tab.title.toLowerCase().includes(searchQuery.toLowerCase())
                ) : true;

            if (!shouldShow) return null;

            return renderTreeItem({
                key: windowIndex,
                type: 'window',
                icon: renderIcon('window'),
                title: `Window`,
                meta: `${window.tabs.length} tabs`,
                includeDelete: !isCurrentSession,
                onDelete: () => handleDeleteItem(activeSessionId, 'window', windowIndex),
                data: window,
                isCurrentSession,
                children: [
                    // Render tab groups
                    ...(window.tabGroups || []).map(group => {
                        const tabs = groupedTabs[group.id] || [];
                        const groupDiv = renderTreeItem({
                            key: group.id,
                            type: 'tab-group',
                            icon: renderIcon('tab-group'),
                            title: group.title || 'Unnamed group',
                            meta: `${tabs.length} tabs`,
                            includeDelete: !isCurrentSession,
                            onDelete: () => handleDeleteItem(activeSessionId, 'tab-group', windowIndex, group.title),
                            data: {
                                id: group.id,
                                title: group.title,
                                color: group.color,
                                collapsed: group.collapsed,
                                tabs: tabs
                            },
                            isCurrentSession,
                            children: tabs.map(tab => renderTreeItem({
                                key: tab.id,
                                type: 'tab',
                                icon: tab.favIconUrl ? e('img', {
                                    src: tab.favIconUrl,
                                }) : renderIcon('url'),
                                title: tab.title,
                                includeDelete: !isCurrentSession,
                                onDelete: () => handleDeleteItem(activeSessionId, 'tab', windowIndex, tab.title),
                                data: tab,
                                isCurrentSession
                            }))
                        });

                        return e('div', {
                            key: group.id,
                            className: 'tab-group-container',
                            'data-color': group.color
                        }, groupDiv);
                    }),
                    // Render ungrouped tabs
                    ...ungroupedTabs.map(tab => renderTreeItem({
                        key: tab.id,
                        type: 'tab',
                        icon: tab.favIconUrl ? e('img', {
                            src: tab.favIconUrl,
                        }) : renderIcon('url'),
                        title: tab.title,
                        includeDelete: !isCurrentSession,
                        onDelete: () => handleDeleteItem(activeSessionId, 'tab', windowIndex, tab.title),
                        data: tab,
                        isCurrentSession
                    }))
                ]
            });
        });
    }

    function renderDetailView() {
        const activeSession = sessions.find(s => s.id === activeSessionId);
        const [sessionName, setSessionName] = React.useState('');
        const saveButtonRef = React.useRef(null);

        async function handleSave(e) {
            // Prevent any default form submission
            e?.preventDefault();

            // Immediately disable the button to prevent double clicks
            if (saveButtonRef.current) {
                saveButtonRef.current.disabled = true;
            }

            let name = sessionName.trim();
            if (!name) {
                name = 'Untitled session';
            }

            await handleSaveSession(name);
            setSessionName('');

            // Re-enable the button after a short delay
            setTimeout(() => {
                if (saveButtonRef.current) {
                    saveButtonRef.current.disabled = false;
                }
            }, 1000);
        }

        return e('div', { className: 'main-content' },
            e('div', { className: 'search-bar' },
                e('input', {
                    type: 'text',
                    placeholder: 'Search tabs...',
                    value: searchQuery,
                    onChange: e => setSearchQuery(e.target.value)
                })
            ),
            e('div', { className: 'detail-section' },
                e('div', { className: 'detail-header' },
                    e('div', {
                        className: 'titleContainer',
                        style: activeSessionId !== 'current' ? { cursor: 'pointer' } : undefined,
                        onClick: () => {
                            if (activeSessionId !== 'current' && activeSession) {
                                handleRenameSession(activeSession.id, activeSession.name);
                            }
                        }
                    },
                        e('div', { className: 'iconContainer' },
                            activeSessionId === 'current' ? renderIcon('url') : renderIcon('list')
                        ),
                        e('div', { className: 'textContainer' },
                            e('div', { className: 'title' },
                                activeSessionId === 'current' ? 'This browser' : activeSession?.name
                            ),
                            e('div', { className: 'tabCount' },
                                `${activeSessionId === 'current' ? currentTabs.totalTabs : activeSession?.totalTabs} tabs`
                            )
                        )
                    ),
                    activeSessionId === 'current' ?
                        e('div', { className: 'actions' },
                            e('form', {
                                onSubmit: handleSave,
                                style: { display: 'flex', gap: 'var(--content-gap)' }
                            },
                                e('input', {
                                    type: 'text',
                                    placeholder: 'Enter session name...',
                                    className: 'input',
                                    value: sessionName,
                                    onChange: e => setSessionName(e.target.value),
                                }),
                                e('button', {
                                    ref: saveButtonRef,
                                    type: 'submit',
                                    className: 'button',
                                    disabled: isSaving
                                }, isSaving ? 'Saving...' : 'Save')
                            )
                        ) :
                        activeSession && e(SessionActions, { session: activeSession })
                ),
                e('div', { id: 'detailContent' },
                    activeSessionId === 'current' ?
                        renderWindows(currentTabs.windows, true) :
                        activeSession && renderWindows(activeSession.windows)
                )
            )
        );
    }

    return e('div', { style: { display: 'flex', height: '100vh' } },
        renderSidebar(),
        renderDetailView()
    );
}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(e(App)); 