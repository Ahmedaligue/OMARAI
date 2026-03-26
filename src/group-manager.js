import { groupSettings, warningsTracker, antiPrivateSettings, blocklist } from './storage.js';

const linkPatterns = [
    /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[a-zA-Z0-9]+/gi,
    /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9?=._-]+/gi,
    /(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]+/gi,
    /(?:https?:\/\/)?(?:www\.)?discord\.gg\/[a-zA-Z0-9]+/gi,
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/gi,
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/groups\/[a-zA-Z0-9]+/gi,
    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@?[a-zA-Z0-9_.]+/gi,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(channel|c|user|@)[a-zA-Z0-9_-]+/gi,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/[a-zA-Z0-9_-]+/gi,
    /(?:https?:\/\/)?(?:www\.)?twitter\.com\/[a-zA-Z0-9_]+/gi,
    /(?:https?:\/\/)?(?:www\.)?x\.com\/[a-zA-Z0-9_]+/gi
];

const GROUP_LINK = 'https://chat.whatsapp.com/Ct6Fvzf9XL0ApWDNqk8hlS';

function containsGroupLink(text) {
    return linkPatterns.some(pattern => {
        pattern.lastIndex = 0;
        return pattern.test(text);
    });
}

function isWhatsAppGroupLink(text) {
    const whatsappGroupPattern = /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/([a-zA-Z0-9]+)/gi;
    return whatsappGroupPattern.test(text);
}

function extractGroupCode(text) {
    const match = text.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/i);
    return match ? match[1] : null;
}

export async function isBotAdmin(sock, groupJid) {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        const botPhone = sock.user?.id?.split(':')[0]?.split('@')[0];
        const botLid = sock.user?.lid?.split(':')[0]?.split('@')[0];
        
        const botParticipant = metadata.participants.find(p => {
            const participantPhone = p.id?.split(':')[0]?.split('@')[0];
            return participantPhone === botPhone || participantPhone === botLid;
        });
        
        const isAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        console.log(`🔍 Bot Admin Check: botPhone=${botPhone}, botLid=${botLid}, found=${!!botParticipant}, isAdmin=${isAdmin}`);
        return isAdmin;
    } catch (e) {
        console.error('Error checking bot admin status:', e.message);
        return false;
    }
}

export async function isUserAdmin(sock, groupJid, userJid) {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        const userPhone = userJid?.split(':')[0]?.split('@')[0];
        
        const userParticipant = metadata.participants.find(p => {
            const participantPhone = p.id?.split(':')[0]?.split('@')[0];
            return participantPhone === userPhone;
        });
        
        return userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
    } catch (e) {
        console.error('Error checking user admin status:', e.message);
        return false;
    }
}

export async function blockUserOnWhatsApp(sock, userJid) {
    try {
        await sock.updateBlockStatus(userJid, 'block');
        console.log(`🚫 تم حظر المستخدم على واتساب: ${userJid}`);
        return true;
    } catch (e) {
        console.error('Error blocking user on WhatsApp:', e.message);
        return false;
    }
}

export async function unblockUserOnWhatsApp(sock, userJid) {
    try {
        await sock.updateBlockStatus(userJid, 'unblock');
        console.log(`✅ تم رفع الحظر عن المستخدم: ${userJid}`);
        return true;
    } catch (e) {
        console.error('Error unblocking user on WhatsApp:', e.message);
        return false;
    }
}

export async function handleAntiLink(sock, msg, text, senderJid, groupJid, senderPhone) {
    const settings = groupSettings.get(groupJid);
    
    if (!settings.antiLink || !containsGroupLink(text)) {
        return { action: 'none' };
    }

    const isBotAdminStatus = await isBotAdmin(sock, groupJid);
    if (!isBotAdminStatus) {
        return { action: 'none' };
    }

    const isSenderAdmin = await isUserAdmin(sock, groupJid, senderJid);
    if (isSenderAdmin) {
        return { action: 'none', message: '*📣 أنت مسؤول، أنت آمن*' };
    }

    if (isWhatsAppGroupLink(text)) {
        try {
            const currentGroupCode = await sock.groupInviteCode(groupJid);
            const sentCode = extractGroupCode(text);
            
            if (sentCode === currentGroupCode) {
                return { action: 'none', message: 'لقد أرسلت رابط المجموعة هذا. أنت آمن!' };
            }
        } catch (e) {
            console.error('Error getting group invite code:', e.message);
        }
    }

    try {
        await sock.sendMessage(groupJid, { delete: msg.key });
    } catch (e) {
        console.error('Error deleting message:', e.message);
    }

    return {
        action: 'kick',
        reason: 'نشر روابط مجموعات أو قنوات',
        message: `*❗ تم اكتشاف أنك ترسل رابط مجموعة أو قناة*\n*سيتم طردك من المجموعة*\n\n@${senderPhone}`
    };
}

export async function handleAntiBadWords(sock, msg, text, senderJid, groupJid, senderPhone, badWordsConfig) {
    const settings = groupSettings.get(groupJid);
    
    if (!settings.antiBadWords || !text) {
        return { action: 'none' };
    }

    const isBotAdminStatus = await isBotAdmin(sock, groupJid);
    if (!isBotAdminStatus) {
        return { action: 'none' };
    }

    const isSenderAdmin = await isUserAdmin(sock, groupJid, senderJid);
    if (isSenderAdmin) {
        return { action: 'none' };
    }

    const lowerText = text.toLowerCase().trim();
    const foundWords = [];

    for (const word of badWordsConfig.words) {
        const lowerWord = word.toLowerCase();
        const escapedWord = lowerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBoundaryRegex = new RegExp(`(^|[\\s.,!?؟،:;()\\[\\]{}'"\\-])${escapedWord}($|[\\s.,!?؟،:;()\\[\\]{}'"\\-])`, 'i');

        if (wordBoundaryRegex.test(lowerText)) {
            foundWords.push(word);
        }
    }

    if (foundWords.length === 0) {
        return { action: 'none' };
    }

    console.log(`⚠️ كلمات ممنوعة في المجموعة من ${senderPhone}: ${foundWords.join(', ')}`);

    try {
        await sock.sendMessage(groupJid, { delete: msg.key });
    } catch (e) {
        console.error('Error deleting bad words message:', e.message);
    }

    return {
        action: 'kick',
        reason: 'استخدام كلمات ممنوعة',
        message: `*⛔ تم طردك من المجموعة*\n\n❌ استخدمت كلمات ممنوعة\n🚫 السب والشتم ممنوع هنا\n\n@${senderPhone}`
    };
}

export async function handleAntiPrivate(sock, remoteJid, senderPhone, isDeveloper) {
    if (isDeveloper) {
        return { action: 'none' };
    }

    const settings = antiPrivateSettings;
    if (!settings.isEnabled()) {
        return { action: 'none' };
    }

    if (settings.isBlockedInPrivate(senderPhone)) {
        return { action: 'ignore_private' };
    }

    const groupLink = settings.getGroupLink();
    
    settings.addBlockedInPrivate(senderPhone);
    
    return {
        action: 'block_private_soft',
        message: `*🤖 مرحباً بك!*\n\n❌ هذا البوت يعمل فقط في المجموعات\n\n✅ انضم إلى مجموعتنا الرسمية:\n${groupLink}\n\n_تم حظرك في الخاص فقط_\n_يمكنك استخدام البوت في المجموعات بشكل طبيعي_\n_للرفع الحظر تواصل مع المطور_`
    };
}

export async function handleAntiTime(sock, groupJid) {
    const settings = groupSettings.get(groupJid);
    const antiTime = settings.antiTime;

    if (!antiTime || !antiTime.enabled) {
        return { action: 'none' };
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    const closeHour = parseInt(antiTime.closeTime.split(':')[0]);
    const openHour = parseInt(antiTime.openTime.split(':')[0]);

    const shouldBeClosed = currentHour >= closeHour || currentHour < openHour;

    if (shouldBeClosed && antiTime.status !== 'closed') {
        return { action: 'close_group', closeTime: antiTime.closeTime, openTime: antiTime.openTime };
    } else if (!shouldBeClosed && antiTime.status === 'closed') {
        return { action: 'open_group', closeTime: antiTime.closeTime, openTime: antiTime.openTime };
    }

    return { action: 'none' };
}

export async function processAntiTimeAction(sock, groupJid, action) {
    try {
        if (!sock || !sock.user) {
            console.log('⚠️ Socket not connected, skipping anti-time action');
            return false;
        }
        
        const settings = groupSettings.get(groupJid);
        
        if (action.action === 'close_group') {
            let metadata;
            try {
                metadata = await Promise.race([
                    sock.groupMetadata(groupJid),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
                ]);
            } catch (metaError) {
                console.log(`⚠️ Could not get group metadata: ${metaError.message}`);
                return false;
            }
            
            const originalName = metadata.subject;
            
            try {
                await sock.groupSettingUpdate(groupJid, 'announcement');
            } catch (settingError) {
                if (settingError.message?.includes('Connection Closed') || settingError.message?.includes('Timed Out')) {
                    console.log('⚠️ Connection issue during group setting update, will retry later');
                    return false;
                }
                throw settingError;
            }
            
            try {
                await sock.groupUpdateSubject(groupJid, `${originalName} (❌ مغلق)`);
            } catch (e) {
                console.log('Could not update group name:', e.message);
            }

            try {
                await sock.sendMessage(groupJid, {
                    text: `🚫 *تم إغلاق المجموعة مؤقتاً*\n\nدائماً اقرؤوا قوانين المجموعة حتى لا يتم طردكم\n\n✅ سيتم إعادة فتحها في *${action.openTime}*`
                });
            } catch (msgError) {
                console.log('Could not send close message:', msgError.message);
            }

            groupSettings.set(groupJid, {
                antiTime: { ...settings.antiTime, status: 'closed' },
                originalName: originalName
            });

            console.log(`🔒 تم إغلاق المجموعة: ${groupJid}`);
            return true;
        }

        if (action.action === 'open_group') {
            try {
                await sock.groupSettingUpdate(groupJid, 'not_announcement');
            } catch (settingError) {
                if (settingError.message?.includes('Connection Closed') || settingError.message?.includes('Timed Out')) {
                    console.log('⚠️ Connection issue during group setting update, will retry later');
                    return false;
                }
                throw settingError;
            }
            
            if (settings.originalName) {
                try {
                    await sock.groupUpdateSubject(groupJid, settings.originalName);
                } catch (e) {
                    console.log('Could not restore group name:', e.message);
                }
            }

            try {
                await sock.sendMessage(groupJid, {
                    text: `✅ *تم إعادة فتح المجموعة*\n\nاستمتعوا بمميزات البوت واقرؤوا قوانين المجموعة\n\n🔒 وقت الإغلاق التالي: *${action.closeTime}*`
                });
            } catch (msgError) {
                console.log('Could not send open message:', msgError.message);
            }

            groupSettings.set(groupJid, {
                antiTime: { ...settings.antiTime, status: 'opened' }
            });

            console.log(`🔓 تم فتح المجموعة: ${groupJid}`);
            return true;
        }
    } catch (e) {
        const errorMsg = e.message || String(e);
        if (errorMsg.includes('Connection Closed') || errorMsg.includes('Timed Out')) {
            console.log('⚠️ Connection issue in anti-time action, will retry on next cycle');
        } else {
            console.error('Error processing anti-time action:', errorMsg);
        }
        return false;
    }
}

export async function handleGroupMessage(sock, msg, text, senderJid, groupJid, senderPhone, badWordsConfig) {
    const antiLinkResult = await handleAntiLink(sock, msg, text, senderJid, groupJid, senderPhone);
    if (antiLinkResult.action === 'kick') {
        return antiLinkResult;
    }

    const antiBadWordsResult = await handleAntiBadWords(sock, msg, text, senderJid, groupJid, senderPhone, badWordsConfig);
    if (antiBadWordsResult.action === 'kick' || antiBadWordsResult.action === 'warn') {
        return antiBadWordsResult;
    }

    return { action: 'none' };
}

export async function processGroupAction(sock, groupJid, senderJid, senderPhone, action) {
    if (action.action === 'none') return false;

    try {
        const isBotAdminStatus = await isBotAdmin(sock, groupJid);
        if (!isBotAdminStatus) {
            console.log('Bot is not admin in this group');
            return false;
        }

        if (action.action === 'warn') {
            await sock.sendMessage(groupJid, {
                text: action.message,
                mentions: [senderJid]
            });
            return true;
        }

        if (action.action === 'kick') {
            await sock.sendMessage(groupJid, {
                text: action.message,
                mentions: [senderJid]
            });
            
            await sock.groupParticipantsUpdate(groupJid, [senderJid], 'remove');
            console.log(`Kicked ${senderPhone} from group: ${action.reason}`);
            return true;
        }
    } catch (e) {
        console.error('Error processing group action:', e.message);
        return false;
    }
}

export async function processAntiPrivateAction(sock, remoteJid, senderPhone, action) {
    if (action.action === 'none') return false;

    try {
        if (action.action === 'block_private_soft') {
            await sock.sendMessage(remoteJid, { text: action.message });
            
            const userJid = `${senderPhone}@s.whatsapp.net`;
            await blockUserOnWhatsApp(sock, userJid);
            
            console.log(`🚫 تم حظر ${senderPhone} في الخاص فقط - يمكنه استخدام البوت في المجموعات`);
            return true;
        }
        
        if (action.action === 'block_private') {
            await sock.sendMessage(remoteJid, { text: action.message });
            
            const userJid = `${senderPhone}@s.whatsapp.net`;
            await blockUserOnWhatsApp(sock, userJid);
            
            console.log(`🚫 تم حظر ${senderPhone} لإرسال رسالة خاصة`);
            return true;
        }
        
        if (action.action === 'reply_private') {
            await sock.sendMessage(remoteJid, { text: action.message });
            return true;
        }
    } catch (e) {
        console.error('Error processing anti-private action:', e.message);
        return false;
    }
}

export function setupAntiTimeScheduler(sock) {
    const checkAllGroups = async () => {
        try {
            const allGroups = groupSettings.getAll();
            
            for (const groupJid in allGroups) {
                const settings = allGroups[groupJid];
                if (settings.antiTime?.enabled) {
                    const action = await handleAntiTime(sock, groupJid);
                    if (action.action !== 'none') {
                        await processAntiTimeAction(sock, groupJid, action);
                    }
                }
            }
        } catch (e) {
            console.error('Error in anti-time scheduler:', e.message);
        }
    };

    setInterval(checkAllGroups, 60000);
    console.log('✅ تم تهيئة جدولة إغلاق/فتح المجموعات تلقائياً');
}

export async function setAntiTime(sock, groupJid, enabled, closeTime = '20:00', openTime = '08:00') {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        const originalName = metadata.subject;

        groupSettings.set(groupJid, {
            antiTime: {
                enabled,
                closeTime,
                openTime,
                status: 'opened'
            },
            originalName
        });

        return {
            success: true,
            message: enabled 
                ? `✅ تم تفعيل الإغلاق/الفتح التلقائي\n\n📌 الإغلاق: ${closeTime}\n📌 الفتح: ${openTime}`
                : '❌ تم إلغاء تفعيل الإغلاق/الفتح التلقائي'
        };
    } catch (e) {
        console.error('Error setting anti-time:', e.message);
        return { success: false, message: '❌ فشل في تحديث الإعدادات' };
    }
}

export async function setAntiLink(groupJid, enabled) {
    groupSettings.set(groupJid, { antiLink: enabled });
    return {
        success: true,
        message: enabled 
            ? '✅ تم تفعيل Anti-Link\n\n🔗 سيتم حذف الروابط وطرد المرسل تلقائياً'
            : '❌ تم إلغاء Anti-Link'
    };
}

export async function setAntiBadWords(groupJid, enabled) {
    groupSettings.set(groupJid, { antiBadWords: enabled });
    return {
        success: true,
        message: enabled 
            ? '✅ تم تفعيل Anti-BadWords\n\n🚫 سيتم حذف الكلمات الممنوعة وتحذير/طرد المرسل'
            : '❌ تم إلغاء Anti-BadWords'
    };
}

export async function enableAllProtection(sock, groupJid, closeTime = '20:00', openTime = '08:00') {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        const originalName = metadata.subject;

        groupSettings.set(groupJid, {
            antiLink: true,
            antiBadWords: true,
            antiPrivate: true,
            antiTime: {
                enabled: true,
                closeTime,
                openTime,
                status: 'opened'
            },
            welcome: true,
            originalName
        });

        return {
            success: true,
            message: `✅ *تم تفعيل جميع الحمايات للمجموعة*\n\n🔗 Anti-Link: ✅ مفعل\n🚫 Anti-BadWords: ✅ مفعل\n⏰ Anti-Time: ✅ مفعل\n   - الإغلاق: ${closeTime}\n   - الفتح: ${openTime}\n\n_جميع الميزات تعمل تلقائياً_`
        };
    } catch (e) {
        console.error('Error enabling all protection:', e.message);
        return { success: false, message: '❌ فشل في تفعيل الحمايات' };
    }
}

export function getGroupProtectionStatus(groupJid) {
    const settings = groupSettings.get(groupJid);
    
    return `*📊 حالة حمايات المجموعة:*\n\n` +
        `🔗 Anti-Link: ${settings.antiLink ? '✅ مفعل' : '❌ معطل'}\n` +
        `🚫 Anti-BadWords: ${settings.antiBadWords ? '✅ مفعل' : '❌ معطل'}\n` +
        `⏰ Anti-Time: ${settings.antiTime?.enabled ? `✅ مفعل (إغلاق: ${settings.antiTime.closeTime} - فتح: ${settings.antiTime.openTime})` : '❌ معطل'}\n` +
        `👋 Welcome: ${settings.welcome ? '✅ مفعل' : '❌ معطل'}`;
}
