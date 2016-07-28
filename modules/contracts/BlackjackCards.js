var private = {},
    self = null,
    library = null,
    modules = null;

//
// BlackjackCards contract
//

function BlackjackCards(cb, _library) {
    console.log("!!!!!!!!!! BlackjackCards function");

    self = this;
    self.type = 7
    library = _library;
    cb(null, self);
}

BlackjackCards.prototype.create = function(data, trs) {
    console.log("!!!!!!!!!! BlackjackCards.create");

    trs.amount = 10000000;
    trs.recipientId = data.recipientId;

    trs.asset = {
        cards: new Buffer(data.cards, 'utf8').toString('hex')
    };

    return trs;
}

BlackjackCards.prototype.calculateFee = function(trs) {
    console.log("!!!!!!!!!! BlackjackCards.calculateFee");
    return 10000000;
}

BlackjackCards.prototype.verify = function(trs, sender, cb, scope) {
    console.log("!!!!!!!!!! BlackjackCards.verify");

    if (trs.amount != 10000000) {
        return cb("Incorrect amount for message");
    }

    if (trs.asset.cards.length > 320) {
        return setImmediate(cb, "Max length of message is 320 characters");
    }

    setImmediate(cb, null, trs);
}

BlackjackCards.prototype.getBytes = function(trs) {
    console.log("!!!!!!!!!! BlackjackCards.getBytes");
    return new Buffer(trs.asset.cards, 'hex');
}

BlackjackCards.prototype.apply = function(trs, sender, cb, scope) {
    console.log("!!!!!!!!!! BlackjackCards.apply");
    var amount = trs.amount + trs.fee;
    modules.blockchain.accounts.mergeAccountAndGet({
        address: sender.address,
        balance: -amount
    }, cb);
}

BlackjackCards.prototype.undo = function(trs, sender, cb, scope) {
    console.log("!!!!!!!!!! BlackjackCards.undo");
    var amount = trs.amount + trs.fee;
    modules.blockchain.accounts.undoMerging({
        address: sender.address,
        balance: -amount
    }, cb);
}

BlackjackCards.prototype.applyUnconfirmed = function(trs, sender, cb, scope) {
    console.log("!!!!!!!!!! BlackjackCards.applyUnconfirmed");
    if (sender.u_balance < trs.fee) {
        return setImmediate(cb, "Sender doesn't have enough coins");
    }

    var amount = trs.amount + trs.fee;
    modules.blockchain.accounts.mergeAccountAndGet({
        address: sender.address,
        u_balance: -amount
    }, cb);
}

BlackjackCards.prototype.undoUnconfirmed = function(trs, sender, cb, scope) {
    console.log("!!!!!!!!!! BlackjackCards.undoUnconfirmed");
    var amount = trs.amount + trs.fee;
    modules.blockchain.accounts.undoMerging({
        address: sender.address,
        u_balance: -amount
    }, cb);
}

BlackjackCards.prototype.ready = function(trs, sender, cb, scope) {
    console.log("!!!!!!!!!! BlackjackCards.ready");
    setImmediate(cb);
}

BlackjackCards.prototype.save = function(trs, cb) {
    console.log("!!!!!!!!!! BlackjackCards.save");
    modules.api.sql.insert({
        table: "asset_blackjackcards",
        values: {
            transactionId: trs.id,
            cards: trs.asset.cards
        }
    }, cb);
}

BlackjackCards.prototype.dbRead = function(row) {
    console.log("!!!!!!!!!! BlackjackCards.dbRead");
    if (!row.t_cards_transactionId) {
        return null;
    } else {
        return {
            cards: row.t_cards_message
        };
    }
}

BlackjackCards.prototype.normalize = function(asset, cb) {
    console.log("!!!!!!!!!! BlackjackCards.normalize");
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
    console.log("!!!!!!!!!! BlackjackCards.onBind");
    modules = _modules;
    modules.logic.transaction.attachAssetType(self.type, self);
}

//
// JSON API
//

BlackjackCards.prototype.add = function(cb, query) {
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
        // If error exists, execute callback with error as first argument
        if (err) {
            return cb(err[0].message);
        }
    });

    var keypair = modules.api.crypto.keypair(query.secret);

    console.log(keypair);

    modules.blockchain.accounts.getAccount({
        publicKey: keypair.publicKey.toString('hex')
    }, function(err, account) {
        if (err) {
            return cb(err);
        }

        var transaction;

        try {
            transaction = library.modules.logic.transaction.create({
                type: self.type,
                cards: query.cards,
                recipientId: query.recipientId,
                sender: account,
                keypair: keypair
            });
        } catch (e) {
            return setImmediate(cb, e.toString());
        }

        modules.blockchain.transactions.processUnconfirmedTransaction(transaction, cb);
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
                type: 'left outer',
                table: 'asset_blackjackcards',
                alias: "t_cards",
                on: { "t.id": "t_cards.transactionId" }
            }]
        }, ['id', 'type', 'senderId', 'senderPublicKey', 'recipientId', 'amount', 'fee', 'timestamp', 'signature', 'blockId', 'token', 'cards', 'transactionId'], function(err, transactions) {
            if (err) {
                return cb(err.toString());
            }

            // Map results to asset object
            var cards = transactions.map(function(tx) {
                tx.asset = {
                    cards: new Buffer(tx.cards, 'hex').toString('utf8')
                };

                delete tx.cards;
                return tx;
            });

            return cb(null, {
                cards: cards
            })
        });
    });
}

module.exports = BlackjackCards;