var search = {
    setup: new Search
};

function Search() {
    const self = this;

    this.DOM = {
        inputQuery: document.querySelector('.query-input'),
        ngramInput: document.querySelector('.n-gram'),
        wildcardInput: document.querySelector('.wildcard')
    };

    // search through the database using simple query
    this.query = function() {
        $('.submit').click(function() {
            if (self.DOM.inputQuery.value !== "") {
                $('.submit .ion-load-c').show();
                self.init();

                var url = 'search.php';
                jsonQuery = JSON.stringify(self.DOM.inputQuery.value);
                $.ajax({
                    url: url,
                    type: 'POST',
                    data: {
                        query: jsonQuery,
                        searchType: $('[name="filterType"]:checked').attr('id')
                    },
                    cache: false,
                    success: function(res) {
                        setTimeout(function() {
                            $('.ion-load-c').hide();
                        }, 500);
                        self.buildUI(JSON.parse(res));
                    }
                });
            }
        });
    };

    // search through the database using n-grams
    this.ngrams = function() {
        $('.search-ngram').click(function() {
            if (self.DOM.ngramInput.value !== "") {
                $('.search-ngram .ion-load-c').show();
                self.init();
                self.load(self.DOM.ngramInput.value, 'ngrams.php');
            }
        });
    };

    // search through the database using filled 7 days
    this.filled7Days = function() {
        $('.ion-load-c').show();

        self.init();
        self.load(null, 'filledAction.php');
    };

    // search through the database using registered 7 days
    this.registered7Days = function() {
        $('.ion-load-c').show();

        self.init();
        self.load(null, 'registeredAction.php');
    };

    // search through the database using publishedOpposition
    this.publishedForOpposition = function() {
        $('.ion-load-c').show();

        self.init();
        self.load(null, 'publishedOppositionAction.php');
    };

    // search through the database using wildcard
    this.wildcard = function() {
        $('.search-wildcard').click(function() {
            if ($('.wildcard').val() !== "" && $('.wildcard').val().length >= 3) {
                $('.search-wildcard .ion-load-c').show();
                $('.wildcard').parent().first().removeClass('has-danger');
                self.init();
                self.load(self.DOM.wildcardInput.value, 'wildcard.php');
            }
            else {
                $('.wildcard').parent().first().addClass('has-danger');
            }
        });
    };

    // load dynammic data
    this.load = function(query, url) {
        jsonQuery = JSON.stringify(query);
        $.ajax({
            url: url,
            type: 'POST',
            data: {
                query: jsonQuery
            },
            cache: false,
            success: function(res) {
                setTimeout(function() {
                    $('.ion-load-c').hide();
                }, 500);
                self.buildUI(JSON.parse(res));
            }
        });
    };

    // convert datetime format from 'M-d-Y' to 'M d, Y'
    this.timeConvert = function(s) {
        var month, day, year;
        month = s.split("-")[0];
        day = s.split("-")[1];
        year = s.split("-")[2];
        return (year !== undefined) ? month + ' ' + day + ', ' + year : 'Not Registered';
    };

    // check for status if is dead or live
    this.checkStatus = function(status) {
        return status === "DEAD" ? "<span class='badge badge-danger'>DEAD</span>" :
                                    "<span class='badge badge-success'>LIVE</span>";
    };

    this.checkType = function(type, serial) {
        if (type.toLowerCase() === "design") {
            return '<div data-toggle="tooltip" data-html="true" data-placement="right" title="<img src=\'http://tsdr.uspto.gov/img/' + serial + '/large\' />" class="type-popup"><span>' + type + '</span></div>'
        }
        else if (type.toLowerCase() === "typeset") {
            return '<div data-toggle="tooltip" title="No Standard Character Claim" data-placement="top" class="type-popup" data-html="true"><span>' + type + '</span></div>'
        }
        
        else return type       
        
    }

    // check if the clothing is 1 or 0
    this.checkClothing = function(data) {
        return data === "YES" ?  "<i class='ion-tshirt'></i> Yes" : "No";
    };

    this.getMonthFromString = function(mon) {
        return new Date(Date.parse(mon +" 1, 2017")).getMonth()+1
    };

    this.convertStringToUSDate = function(str)
    {
        if(str.trim() != '') {
            var dateSplit = str.split('-');
            if(dateSplit.length >= 3) {
                var month = self.getMonthFromString(dateSplit[0]);
                month = month < 10 ? '0' + month : month;
                return dateSplit[2] + '-' + month + '-' + dateSplit[1];
            }
        }
        return '';
    }

    this.init = function() {
        $('.status-button').text('Status');
        $('.type-button').text('Type');
        $('.registered-button').text('Registered');
    };

    // build ui table
    this.buildUI = function(res) {
        var buttonCommon = {
            exportOptions: {
                format: {
                    body: function ( data, row, column, node ) {
                        // Strip $ from salary column to make it numeric
                        //return column === 5 ? data.replace( /[$,]/g, '' ) :  data;
                        return data;
                    }
                }
            }
        };

        var table = $('#table').DataTable({
            destroy: true,
            lengthChange: true,
            pageLength:25,
            language: {
                infoFiltered: "(from _MAX_ total results)",
                info: "_START_ to _END_ of _TOTAL_ results"
            },
            buttons: [
                {
                    extend: 'csvHtml5',
                    customize: function (csv) {
                        debugger;
                        var split_csv = csv.split("\n");
                        split_csv[0] = '"Serial","Trademark","Status","Type","Filed on","Registered on","Link"';

                        $.each(split_csv.slice(1), function (index, csv_row) {
                            //Split on quotes and comma to get each cell
                            var csv_cell_array = csv_row.split('","');
                            //Remove replace the two quotes which are left at the beginning and the end (first and last cell)
                            csv_cell_array[0] = csv_cell_array[0].replace(/"/g, '');
                            csv_cell_array[csv_cell_array.length - 1] = csv_cell_array[csv_cell_array.length - 1].replace(/"/g, '');

                            csv_cell_array[4] = self.convertStringToUSDate(csv_cell_array[4]);
                            csv_cell_array[5] = self.convertStringToUSDate(csv_cell_array[5]);

                            csv_cell_array[6] = 'http://tsdr.uspto.gov/#caseNumber=' + csv_cell_array[0] + '&caseType=SERIAL_NO&searchType=statusSearch';

                            //Join the table on the quotes and comma; add back the quotes at the beginning and end
                            csv_cell_array_quotes = '"' + csv_cell_array.join('","') + '"';

                            //Insert the new row into the rows array at the previous index (index +1 because the header was sliced)
                            split_csv[index + 1] = csv_cell_array_quotes;
                        });

                        //Join the rows with line breck and return the final csv (datatables will take the returned csv and process it)
                        csv = split_csv.join("\n");
                        return csv;
                    }
                }
               //'csvHtml5'
            ],
            dom: "<'row'<'col-sm-12 col-md-8'l><'col-sm-12 col-md-4'f>><'row'<'col-sm-12'tr>><'row dt-footer'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'pB>>",
            data: res,
            initComplete: function(settings, json) {
                $('.dataTables_filter').parents('.row').children('div').first().append($('.buttons-filter').clone().show());
            },
            drawCallback : function(){
                $('[data-toggle="tooltip"]').tooltip()
            },
            columns: [
                { title: "Serial", width: "60px" },
                { title: "Trademark"},
                { title: "Status", width: "45px"},
                { title: "Type", width: "45px" },
                { title: "Filed on", type: 'date-uk', targets: 0, width: "80px"},
                { title: "Registered on", type: 'date-uk', targets: 0, width: "109px"},
                ],
            fnCreatedRow: function(nRow, aData, iDisplayIndex) {
                $('td:eq(0)', nRow).html('<a href="http://tsdr.uspto.gov/#caseNumber=' + aData[0] + '&caseType=SERIAL_NO&searchType=statusSearch" target="_blank">' + aData[0] + '</a>');
                $('td:eq(2)', nRow).html(self.checkStatus(aData[2]));
                $('td:eq(3)', nRow).html(self.checkType(aData[3], aData[0]));
                $('td:eq(4)', nRow).html(self.timeConvert(aData[4]));
                $('td:eq(5)', nRow).html(self.timeConvert(aData[5]));
                return nRow;
            },
            Language: {
                Processing: "<img src='assets/images/loading.gif'>"
            },
            processing : true
        });

        $('.all').click(function() {
            table
                .columns([2,3,5])
                .search('')
                .draw();
        });

        $('.status').click(function () {
             if ($(this).data('search') == 'all') {
                $('.status-button').text('Status: ' + $(this).text());
                table
                .columns( 2 )
                .search('')
                .draw();
            } else {
            $('.status-button').text('Status: ' + $(this).text());
            table
                .columns( 2 )
                .search( $(this).data('search') )
                .draw();
            }
        } );

        $('.type').click(function () {
            if ($(this).data('search') == 'all') {
                $('.type-button').text('Type: ' + $(this).text());
                table
                .columns( 3 )
                .search('')
                .draw();
            } else {
            $('.type-button').text('Type: ' + $(this).text());
            table
                .columns( 3 )
                .search( $(this).data('search') )
                .draw();
            }
        } );

        $('.rdate').click(function () {
            if ($(this).data('search') == 'all') {
                $('.registered-button').text('Registered: ' + $(this).text());
                table
                .columns( 5 )
                .search('')
                .draw();
            } else {
            $('.registered-button').text('Registered: ' + $(this).text());
            table
                .columns( 5 )
                .search( $(this).data('search') )
                .draw();
            }
        } );
        
        $('.live-text-button').click(function(){
            self.init();

            table
                
                .columns(2)
                .search('live')
                .columns(3)
                .search('text')
                .draw();
                $('.status-button').text('Status: Live')
                $('.type-button').text('Type: Text')
                $(this).tooltip('hide');
        });
        
        $('[data-toggle="tooltip"]').tooltip()
        

        $('.remove-filters-button').click(function(){
            self.init();

            table
                .columns([2,3,5])
                .search('')
                .draw();
            $(this).tooltip('hide');
        });

    };

    $.extend($.fn.dataTableExt.oSort, {
        "date-uk-pre": function ( a ) {
            if (a === null || a === "") {
                return 0;
            }
            var ukDatea = a.split('-');
            var month = (self.getMonthFromString(ukDatea[0]));
            month = month < 10 ? '0' + month : month;
            return (ukDatea[2] + ukDatea[1] + month) * 1;
        },

        "date-uk-asc": function ( a, b ) {
            return ((a < b) ? -1 : ((a > b) ? 1 : 0));
        },

        "date-uk-desc": function ( a, b ) {
            return ((a < b) ? 1 : ((a > b) ? -1 : 0));
        }
    } );

    this.execute = function() {
        self.query();
        self.ngrams();
        self.wildcard();
    };
}

// execute
search.setup.execute();

$(document).ready(function(){
    function validateCharacterCount($textareaEl, $buttonEl, linesLimit, maxCharsPerLineLimit, minimumCharsPerLine, $errorEl) {
        var text = $textareaEl.val();
        var arr = text.split("\n");

        if(arr.filter(Boolean).length > linesLimit) {
            $errorEl.text("You've exceeded the maximum number of lines for this search! (" + linesLimit + ")").removeClass('hidden');
            $buttonEl.attr('disabled', 'disabled');
            return;
        } else {
            for(var i = 0; i < arr.length; i++) {
                if(arr[i].length > 0) {
                    if (arr[i].length > maxCharsPerLineLimit) {
                        $errorEl.text("Maximum " + maxCharsPerLineLimit + ' characters allowed in each line. Line #' + (i + 1) + ' has more than ' + maxCharsPerLineLimit + ' characters.').removeClass('hidden');
                        $buttonEl.attr('disabled', 'disabled');
                        $textareaEl.parent().first().addClass('has-danger');
                        return;
                    }

                    if (minimumCharsPerLine && arr[i].length < minimumCharsPerLine) {
                        $errorEl.text("Minimum " + minimumCharsPerLine + ' characters required for this search. Line #'+ (i + 1) + ' has less than ' + minimumCharsPerLine + ' characters.').removeClass('hidden');
                        $buttonEl.attr('disabled', 'disabled');
                        $textareaEl.parent().first().addClass('has-danger');
                        return;
                    }
                }
            }
        }

        $errorEl.text('').addClass('hidden');
        $buttonEl.removeAttr('disabled');
        $textareaEl.parent().first().removeClass('has-danger');
        //console.log(arr.length + " : " + JSON.stringify(arr));
    }

    $('.n-gram').bind('input keyup', function(){ validateCharacterCount($(this), $('.search-ngram'), 10, 256, null, $('.ngram-error'))});
    $('.wildcard').bind('input keyup', function(){ validateCharacterCount($(this), $('.search-wildcard'), 100, 50, 3, $('.wildcard-error'))});

    $('input[type=radio][name=filterType]').change(function() {
        if (this.id == 'partialMatch') {
            $('.query-input').bind('input keyup', function(){ validateCharacterCount($(this), $('.submit'), 100, 256, 3, $('.query-error')); });
            validateCharacterCount($('.query-input'), $('.submit'), 100, 256, 3, $('.query-error'));
        }
        else {
            $('.query-input').unbind('input keyup');
            $('.query-error').text('').addClass('hidden');
            $('.submit').removeAttr('disabled');
            $('.submit').parent().first().removeClass('has-danger');
        }
    });
});