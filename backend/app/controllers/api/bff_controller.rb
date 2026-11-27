# frozen_string_literal: true

module Api
  class BffController < ApplicationController
    protect_from_forgery with: :null_session
    before_action :verify_bff_token!

    private

    def verify_bff_token!
      expected = ENV['BFF_SHARED_TOKEN'].to_s
      provided = request.headers['X-BFF-Token'].to_s
      head :unauthorized unless expected.present? && ActiveSupport::SecurityUtils.secure_compare(expected, provided)
    end
  end
end
