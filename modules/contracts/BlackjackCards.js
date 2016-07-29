var private = {},
    self = null,
    library = null,
    modules = null;

//
// BlackjackCards contract
//

function BlackjackCards(cb, _library) {
    self = this;
    self.type = 7
    library = _library;
    cb(null, self);
}

BlackjackCards.prototype.create = function(data, trs) {
    trs.recipientId = data.recipientId;

    trs.asset = {
        cards: new Buffer(data.cards, 'utf8').toString('hex')
    };

    return trs;
}

BlackjackCards.prototype.calculateFee = function(trs) {
    return 10000000;
}

BlackjackCards.prototype.verify = function(trs, sender, cb, scope) {
    if (trs.asset.cards.length > 320) {
        return setImmediate(cb, "Max length of message is 320 characters");
    }

    setImmediate(cb, null, trs);
}

BlackjackCards.prototype.getBytes = function(trs) {
    return new Buffer(trs.asset.cards, 'hex');
}

BlackjackCards.prototype.apply = function(trs, sender, cb, scope) {
    modules.blockchain.accounts.mergeAccountAndGet({
        address: sender.address,
        balance: -trs.fee
    }, cb);
}

BlackjackCards.prototype.undo = function(trs, sender, cb, scope) {
    modules.blockchain.accounts.undoMerging({
        address: sender.address,
        balance: -trs.fee
    }, cb);
}

BlackjackCards.prototype.applyUnconfirmed = function(trs, sender, cb, scope) {
    if (sender.u_balance < trs.fee) {
        return setImmediate(cb, "Sender doesn't have enough coins");
    }

    modules.blockchain.accounts.mergeAccountAndGet({
        address: sender.address,
        u_balance: -trs.fee
    }, cb);
}

BlackjackCards.prototype.undoUnconfirmed = function(trs, sender, cb, scope) {
    modules.blockchain.accounts.undoMerging({
        address: sender.address,
        u_balance: -trs.fee
    }, cb);
}

BlackjackCards.prototype.ready = function(trs, sender, cb, scope) {
    setImmediate(cb);
}

BlackjackCards.prototype.save = function(trs, cb) {
    modules.api.sql.insert({
        table: "asset_blackjackcards",
        values: {
            transactionId: trs.id,
            cards: trs.asset.cards
        }
    }, cb);
}

BlackjackCards.prototype.dbRead = function(row) {
    if (!row.t_cards_transactionId) {
        return null;
    } else {
        return {
            cards: row.t_cards_cards
        };
    }
}

BlackjackCards.prototype.normalize = function(asset, cb) {
    library.validator.validate(asset, {
        type: "object",
        properties: {
            cards: {
                type: "string",
                format: "hex",
                minLength: 1
            }
        },
        required: ["cards"]
    }, cb);
}

BlackjackCards.prototype.onBind = function(_modules) {
    modules = _modules;
    modules.logic.transaction.attachAssetType(self.type, self);
}

//
// JSON API
//

BlackjackCards.prototype.add = function(cb, query) {
    var validateQuery = function(callback) {
        library.validator.validate(query, {
            type: "object",
            properties: {
                recipientId: {
                    type: "string",
                    minLength: 1,
                    maxLength: 21
                },
                secret: {
                    type: "string",
                    minLength: 1,
                    maxLength: 100
                },
                cards: {
                    type: "string",
                    minLength: 1,
                    maxLength: 160
                }
            },
            required: ["recipientId", "secret", "cards"]
        }, function(err) {
            if (err)
                return callback(err[0].message);

            callback();
        });
    }

    var createTransaction = function(callback) {
        var keypair = modules.api.crypto.keypair(query.secret);

        modules.blockchain.accounts.getAccount({
            publicKey: keypair.publicKey.toString('hex')
        }, function(err, account) {
            if (err) {
                return callback(err);
            }

            try {
                var transaction = library.modules.logic.transaction.create({
                    type: self.type,
                    cards: query.cards,
                    recipientId: query.recipientId,
                    sender: account,
                    keypair: keypair
                });
            } catch (e) {
                return setImmediate(callback, e.toString());
            }

            modules.blockchain.transactions.processUnconfirmedTransaction(transaction, callback);
        });
    }

    var async = require('async');

    async.series([
        validateQuery,
        createTransaction
    ], function(err, result) {
        return cb(err, result);
    });
}

BlackjackCards.prototype.list = function(cb, query) {
    library.validator.validate(query, {
        type: "object",
        properties: {
            recipientId: {
                type: "string",
                minLength: 2,
                maxLength: 21
            }
        },
        required: ["recipientId"]
    }, function(err) {
        if (err) {
            return cb(err[0].message);
        }

        // Select from transactions table and join messages from the asset_messages table
        modules.api.sql.select({
            table: "transactions",
            alias: "t",
            condition: {
                recipientId: query.recipientId,
                type: self.type
            },
            join: [{
                type: "left outer",
                table: "asset_blackjackcards",
                alias: "t_cards",
                on: { "t.id": "t_cards.\"transactionId\"" }
            }]
        }, ['id', 'type', 'senderId', 'senderPublicKey', 'recipientId', 'amount', 'fee', 'timestamp', 'signature', 'blockId', 'token', 'cards', 'transactionId'], function(err, transactions) {
            if (err) {
                return cb(err.toString());
            }

            // Map results to asset object
            var cards = transactions.map(function(tx) {
                return new Buffer(tx.cards, 'hex').toString('utf8')
            });

            return cb(null, {
                cards: cards
            })
        });
    });
}

module.exports = BlackjackCards;