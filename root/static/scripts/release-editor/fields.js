// This file is part of MusicBrainz, the open internet music database.
// Copyright (C) 2014 MetaBrainz Foundation
// Licensed under the GPL version 2, or (at your option) any later version:
// http://www.gnu.org/licenses/gpl-2.0.txt

(function (releaseEditor) {

    var fields = releaseEditor.fields = releaseEditor.fields || {};
    var utils = releaseEditor.utils;


    ko.extenders.withError = function (target) {
        target.error = releaseEditor.validation.errorField();
    };


    fields.ArtistCredit = aclass(MB.Control.ArtistCredit, {

        around$init: function (supr, data) {
            supr({ initialData: data });
            this.error = releaseEditor.validation.errorField();
        }
    });


    fields.Track = aclass({

        init: function (data, medium) {
            this.medium = medium;

            $.extend(this, _.pick(data, "id", "gid"));

            this.name = ko.observable(data.name);
            this.name.original = data.name;
            this.name.subscribe(this.nameChanged, this);

            this.length = ko.observable(data.length);
            this.length.original = data.length;

            var release = medium && medium.release;

            if (release && !data.artistCredit && !release.artistCredit.isVariousArtists()) {
                data.artistCredit = release.artistCredit.toJSON();
            }

            this.artistCredit = fields.ArtistCredit(data.artistCredit);
            this.artistCredit.track = this;

            this.formattedLength = ko.observable(MB.utility.formatTrackLength(data.length));
            this.position = ko.observable(data.position);
            this.number = ko.observable(data.number);
            this.updateRecording = ko.observable(false).subscribeTo("updateRecordings", true);
            this.hasNewRecording = ko.observable(true);

            this.recordingValue = ko.observable(
                MB.entity.Recording({ name: data.name })
            );

            // Custom write function is needed around recordingValue because
            // when it's written to there's certain values we need to save
            // beforehand (see methods below).
            this.recording = ko.computed({
                read: this.recordingValue,
                write: this.setRecordingValue,
                owner: this
            });

            this.recording.original = ko.observable();
            this.suggestedRecordings = ko.observableArray([]);
            this.loadingSuggestedRecordings = ko.observable(false);

            var recordingData = data.recording;
            if (recordingData) {
                if (_.isEmpty(recordingData.artistCredit)) {
                    recordingData.artistCredit = this.artistCredit.toJSON();
                }
                this.recording(MB.entity(recordingData, "recording"));
                this.recording.original(MB.edit.fields.recording(this.recording.peek()));
                this.hasNewRecording(false);
            }

            releaseEditor.recordingAssociation.track(this);

            this.uniqueID = this.id || _.uniqueId("new-");
            this.elementID = "track-row-" + this.uniqueID;

            this.formattedLength.subscribe(this.formattedLengthChanged, this);
            this.hasNewRecording.subscribe(this.hasNewRecordingChanged, this);
        },

        recordingGID: function () {
            var recording = this.recording();
            return recording ? recording.gid : null;
        },

        nameChanged: function (name) {
            if (!this.hasExistingRecording()) {
                var recording = this.recording.peek();

                recording.name = this.name();
                this.recording.notifySubscribers(recording);
            }
        },

        formattedLengthChanged: function (length) {
            var lengthLength = length.length;

            // Convert stuff like 111 into 1:11

            if (/^\d+$/.test(length) && (4 - lengthLength) <= 1) {
                var minutes, seconds;

                if (lengthLength === 3) minutes = length[0];
                if (lengthLength === 4) minutes = length.slice(0, 2);

                seconds = length.slice(-2);

                if (parseInt(minutes, 10) < 60 && parseInt(seconds, 10) < 60) {
                    length = minutes + ":" + seconds;
                    this.formattedLength(length);
                }
            }
            this.length(MB.utility.unformatTrackLength(length));
        },

        previous: function () {
            var tracks = this.medium.tracks();
            var index = _.indexOf(tracks, this);

            return index > 0 ? tracks[index - 1] : null;
        },

        next: function () {
            var tracks = this.medium.tracks();
            var index = _.indexOf(tracks, this);

            return index < tracks.length - 1 ? tracks[index + 1] : null;
        },

        differsFromRecording: function () {
            var recording = this.recording(), name = this.name();
            if (!recording.gid || !name) return false;

            var length = this.length();

            var sameName = name && name === recording.name,
                sameLength = length === recording.length,
                sameArtist = this.artistCredit.isEqual(recording.artistCredit);

            return !(sameName && sameLength && sameArtist);
        },

        hasExistingRecording: function () {
            return !!this.recording().gid;
        },

        needsRecording: function () {
            return !(this.hasExistingRecording() || this.hasNewRecording());
        },

        hasNewRecordingChanged: function (value) {
            value && this.recording(null);
        },

        setRecordingValue: function (value) {
            value = value || MB.entity.Recording({ name: this.name() });

            var currentValue = this.recording.peek();
            if (value.gid === currentValue.gid) return;

            // Save the current track values to allow for comparison when they
            // change. If they change too much, we unset the recording and find
            // a new suggestion. Only save these if there's a recording to
            // revert back to - it doesn't make sense to save these values for
            // comparison if there's no recording.
            if (value.gid) {
                this.name.saved = this.name.peek();
                this.length.saved = this.length.peek();
                this.recording.saved = value;
                this.recording.savedEditData = MB.edit.fields.recording(value);
                this.hasNewRecording(false);
            }

            if (currentValue.gid) {
                var suggestions = this.suggestedRecordings.peek();

                if (!_.contains(suggestions, currentValue)) {
                    this.suggestedRecordings.unshift(currentValue);
                }
            }

            this.recordingValue(value);
        }
    });


    fields.Medium = aclass({

        init: function (data, release) {
            this.release = release;
            this.name = ko.observable(data.name);
            this.position = ko.observable(data.position || 1);
            this.formatID = ko.observable(data.formatID).extend({ withError: true });
            this.needsRecordings = releaseEditor.validation.errorField(false);

            this.tracks = ko.observableArray(
                utils.mapChild(this, data.tracks, fields.Track)
            )
            .extend({ withError: true });

            $.extend(this, _.pick(data, "id", "toc", "originalID"));

            // The medium is considered to be loaded if it has tracks, or if
            // there's no ID to load tracks from.
            var loaded = !!(this.tracks().length || !(this.id || this.originalID));

            this.cdtocs = data.cdtocs || 0;
            this.loaded = ko.observable(loaded);
            this.loading = ko.observable(false);
            this.collapsed = ko.observable(!loaded);
            this.collapsed.subscribe(this.collapsedChanged, this);
            this.addTrackCount = ko.observable("");
            this.original = ko.observable(MB.edit.fields.medium(this));
        },

        collapsedChanged: function (collapsed) {
            if (!collapsed && !this.loaded() && !this.loading()) {
                this.loadTracks(true);
            }
        },

        loadTracks: function () {
            var id = this.id || this.originalID;
            if (!id) return;

            this.loading(true);

            var args = {
                url: "/ws/js/medium/" + id,
                data: { inc: "recordings" }
            };

            MB.utility.request(args, this).done(this.tracksLoaded);
        },

        tracksLoaded: function (data) {
            this.tracks(utils.mapChild(this, data.tracks, fields.Track));

            // We already have the original name, format, and position data,
            // which we don't want to overwrite - it could have been changed
            // by the user before they loaded the medium. We just need the
            // tracklist data, now that it's loaded.
            var currentEditData = MB.edit.fields.medium(this);
            var originalEditData = this.original();

            originalEditData.tracklist = currentEditData.tracklist;
            this.original.notifySubscribers(originalEditData);

            this.loaded(true);
            this.loading(false);
            this.collapsed(false);
        },

        hasTracks: function () { return !_.isEmpty(this.tracks()) },

        formattedName: function () {
            var name = this.name(),
                position = this.position(),
                multidisc = this.release.mediums().length > 1 || position > 1;

            if (name) {
                if (multidisc) {
                    return MB.i18n.expand(
                        MB.text.DiscNumberTitle, { num: position, title: name }
                    );
                }
                return name;

            }
            else if (multidisc) {
                return MB.i18n.expand(MB.text.DiscNumber, { num: position });
            }
            return MB.text.Tracklist;
        },

        canHaveDiscID: function () {
            // Formats with Disc IDs:
            // CD, SACD, DualDisc, Other, HDCD, CD-R, 8cm CD
            var formatsWithDiscIDs = [1, 3, 4, 13, 25, 33, 34],
                formatID = parseInt(this.formatID(), 10);

            return !formatID || _.contains(formatsWithDiscIDs, formatID);
        }
    });


    fields.ReleaseGroup = aclass(MB.entity.ReleaseGroup, {

        after$init: function (data) {
            data = data || {};

            this.typeID = ko.observable(data.typeID)
            this.secondaryTypeIDs = ko.observableArray(data.secondaryTypeIDs);
            this.error = releaseEditor.validation.errorField();
        }
    });


    fields.ReleaseEvent = aclass({

        init: function (data, release) {
            var date = MB.utility.parseDate(data.date || "");

            this.date = {
                year:   ko.observable(date.year),
                month:  ko.observable(date.month),
                day:    ko.observable(date.day),
                error:  releaseEditor.validation.errorField()
            };

            this.countryID = ko.observable(data.countryID).extend({ withError: true });

            this.release = release;
        },

        unwrapDate: function () {
            return {
                year: this.date.year(),
                month: this.date.month(),
                day: this.date.day()
            };
        },

        hasAmazonDate: function () {
            var date = this.unwrapDate();
            return date.year == 1990 && date.month == 10 && date.day == 25;
        },

        hasJanuaryFirstDate: function () {
            var date = this.unwrapDate();
            return date.month == 1 && date.day == 1;
        }
    });


    fields.ReleaseLabel = aclass({

        init: function (data, release) {
            if (data.id) this.id = data.id;

            this.label = ko.observable(MB.entity(data.label || {}, "label"))
                .extend({ withError: true });

            this.catalogNumber = ko.observable(data.catalogNumber);

            this.release = release;
        },

        labelHTML: function () {
            return this.label().html({ target: "_blank" });
        }
    });


    fields.Barcode = aclass({

        weights: [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3],

        init: function (data) {
            this.barcode = ko.observable(data);
            this.message = ko.observable("");
            this.confirmed = ko.observable(false);
            this.error = releaseEditor.validation.errorField();

            this.value = ko.computed({
                read: this.barcode,
                write: this.writeBarcode,
                owner: this
            });

            // Always notify of changes, so that when non-digits are stripped,
            // the text in the input element will update even if the stripped
            // value is identical to the old value.
            this.barcode.equalityComparer = null;
            this.value.equalityComparer = null;

            this.none = ko.computed({
                read: function () {
                    return this.barcode() === "";
                },
                write: function (bool) {
                    this.barcode(bool ? "" : null);
                },
                owner: this
            });
        },

        checkDigit: function (barcode) {
            if (barcode.length !== 12) return false;

            for (var i = 0, calc = 0; i < 12; i++) {
                calc += parseInt(barcode[i]) * this.weights[i];
            }

            var digit = 10 - (calc % 10);
            return digit === 10 ? 0 : digit;
        },

        validateCheckDigit: function (barcode) {
            return this.checkDigit(barcode.slice(0, 12)) === parseInt(barcode[12], 10);
        },

        writeBarcode: function (barcode) {
            this.barcode((barcode || "").replace(/[^\d]/g, "") || null);
            this.confirmed(false);
        }
    });


    fields.Release = aclass(MB.entity.Release, {

        after$init: function (data) {
            var self = this;

            $.extend(this, _.pick(data, "trackCounts", "formats", "countryCodes"));

            var currentName = data.name;
            this.name = ko.observable(currentName).extend({ withError: true });

            this.name.subscribe(function (newName) {
                var releaseGroup = self.releaseGroup();

                if (!releaseGroup.name || (!releaseGroup.gid &&
                                            releaseGroup.name === currentName)) {
                    releaseGroup.name = newName;
                    self.releaseGroup.notifySubscribers(releaseGroup);
                }
                currentName = newName;
            });

            this.artistCredit = fields.ArtistCredit(data.artistCredit);
            this.artistCredit.saved = fields.ArtistCredit(data.artistCredit);

            this.statusID = ko.observable(data.statusID);
            this.languageID = ko.observable(data.languageID);
            this.scriptID = ko.observable(data.scriptID);
            this.packagingID = ko.observable(data.packagingID);
            this.barcode = fields.Barcode(data.barcode);
            this.comment = ko.observable(data.comment);
            this.annotation = ko.observable(data.annotation || "");
            this.annotation.original = ko.observable(data.annotation || "");

            this.events = ko.observableArray(
                utils.mapChild(this, data.events, fields.ReleaseEvent)
            );

            this.labels = ko.observableArray(
                utils.mapChild(this, data.labels, fields.ReleaseLabel)
            );

            this.labels.original = ko.observable(
                _.map(this.labels.peek(), MB.edit.fields.releaseLabel)
            );

            this.releaseGroup = ko.observable(
                fields.ReleaseGroup(data.releaseGroup || {})
            )
            .extend({ withError: true });

            this.releaseGroup.subscribe(function (releaseGroup) {
                if (releaseGroup.artistCredit && !self.artistCredit.text()) {
                    self.artistCredit.setNames(releaseGroup.artistCredit.names);
                }
            });

            this.mediums = ko.observableArray(
                utils.mapChild(this, data.mediums, fields.Medium)
            )
            .extend({ withError: true });

            this.mediums.originalIDs = _.pluck(this.mediums(), "id");

            this.original = ko.observable(MB.edit.fields.release(this));

            // Ensure there's at least one event, label, and medium to edit.

            if (!this.events().length) {
                this.events.push(fields.ReleaseEvent({}, this));
            }

            if (!this.labels().length) {
                this.labels.push(fields.ReleaseLabel({}, this));
            }

            if (!this.mediums().length) {
                this.mediums.push(fields.Medium({}, this));
            }
        },

        loadMedia: function () {
            var mediums = this.mediums();

            if (mediums.length <= 3) {
                _.invoke(mediums, "loadTracks");
            }
        },

        hasTracks: function () {
            return _.some(_.invoke(this.mediums(), "hasTracks"));
        },

        hasOneEmptyMedium: function () {
            var mediums = this.mediums();
            return mediums.length === 1 && !mediums[0].hasTracks();
        }
    });


    fields.Root = aclass(function () {
        this.release = ko.observable().syncWith("releaseField", true, true);
        this.asAutoEditor = ko.observable(true);
        this.editNote = ko.observable("").extend({ withError: true });
    });


    ko.bindingHandlers.disableBecauseDiscIDs = {

        init: function (element, valueAccessor, allBindings, viewModel) {
            var hasDiscID = viewModel.medium.cdtocs > 0;

            $(element)
                .prop("disabled", hasDiscID)
                .toggleClass("disabled-hint", hasDiscID)
                .attr("title", hasDiscID ? MB.text.DoNotChangeTracks : "");
        }
    };

}(MB.releaseEditor = MB.releaseEditor || {}));
